import { app, BrowserWindow, ipcMain, shell, clipboard, dialog } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { createWindow as createMacWindow } from './platform/mac/window';
import { createWindow as createWindowsWindow } from './platform/windows/window';
import { createTray, openDropPanelFor } from './tray';
import { isAppLockEnabled, setAppLockEnabled, verifyPin, canUseTouchID, tryTouchID } from './security';
import { connectUsbTunnel, disconnectUsbTunnel, launchPairDeepLink } from './adb';
import { composeMailWithAttachments } from './mail';

// package.json's "name" is the scoped npm id "@alliminate/desktop" — without this, Electron derives
// app.getName() straight from it, so every app.getPath() (userData, cache, logs...) resolves under a
// literal "@alliminate/desktop" folder instead of a proper "AllieMinate" one.
app.setName('AllieMinate');

// this app keeps running via the tray after the main window closes, which makes it very easy for the
// user to launch it again (Spotlight, Dock, double-click) without realizing it's already alive —
// previously nothing stopped a second full process from starting: its own main window, its OWN second
// menu bar icon, and its own (redundant, since the port's already taken) backend-spawn attempt. Two
// processes fighting over the same window/tray state is consistent with needing a force-quit to get back
// to normal. Bail out of the second process entirely and just focus the first one's window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// macOS Share Extension handoff — "Share to Connected Devices" and "Add to Cloud Service" (see
// macos-share-extension/) can't hand a file straight to this app process-to-process (a share extension
// runs in its own short-lived process with no IPC channel back to us), so it writes the picked file
// paths to a JSON file next to the app's own data dir, then opens this custom-scheme URL to wake/focus
// this app and tell it which of the two the user picked. Registered before whenReady so a COLD launch
// via the extension (app wasn't already running) still gets the open-url event macOS fires for it.
app.setAsDefaultProtocolClient('alliminate');

const SHARE_HANDOFF_PATH = path.join(app.getPath('userData'), 'share-handoff.json');
// open-url can fire before createTray() has run yet (a cold launch) — openDropPanelFor needs a live
// tray to position its panel against, so a handoff that arrives too early waits for whenReady to finish.
let pendingShareUrl: string | null = null;

function handleShareExtensionUrl(url: string): void {
  let kind: 'cloud' | 'device' | null = null;
  try {
    kind = new URL(url).searchParams.get('kind') as 'cloud' | 'device' | null;
  } catch {
    return;
  }
  if (kind !== 'cloud' && kind !== 'device') return;
  let paths: string[];
  try {
    const handoff = JSON.parse(fs.readFileSync(SHARE_HANDOFF_PATH, 'utf-8'));
    paths = Array.isArray(handoff.paths) ? handoff.paths.filter((p: unknown) => typeof p === 'string') : [];
  } catch {
    return; // extension failed to write the handoff, or it's stale/missing — nothing to share
  }
  if (paths.length === 0) return;
  openDropPanelFor(paths, kind);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) handleShareExtensionUrl(url);
  else pendingShareUrl = url;
});

const BACKEND_PORT = 4310;
const BACKEND_RESTART_MAX_DELAY_MS = 30_000;
let backendProcess: ChildProcess | null = null;
let backendRestarts = 0;
let quitting = false;
// set when the backend dies unexpectedly; reported into the log system once the backend is reachable
// again (it can't log its own crash — it's the thing that's down).
let pendingCrashMessage: string | null = null;

// stdio was previously 'ignore' — when the backend crashed on startup (e.g. a boot-time race before the
// user's session/keychain was fully up, which is exactly when a "launch at login" app is most likely to
// start) there was zero trace of why, anywhere. Now captured to a real log file.
const logPath = path.join(app.getPath('userData'), 'backend.log');
function logToFile(line: string): void {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // best-effort — a logging failure shouldn't take down the app
  }
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// Every piece of runtime state the backend writes (accounts.json, devices.json, folders.json,
// username.json, syncPairs.json, .env — the refresh tokens, everything) used to live INSIDE this same
// packaged .app bundle, at process.resourcesPath/backend/ and process.resourcesPath/../.env. That's the
// bundle a fresh install replaces wholesale — Finder/Explorer deletes the whole old .app and copies in the
// new one, which used to mean every paired device, linked cloud account, pinned/sync folder, and OAuth
// token was gone the moment a user updated to a newer build. Real data loss on update, confirmed, not
// hypothetical. Fixed by moving all of it to app.getPath('userData') (outside the bundle, survives a
// reinstall) — see paths.ts's ALLIMINATE_DATA_DIR. This one-time migration is what carries an EXISTING
// install's data across to the new location the first time a build with this fix runs: without it, moving
// where the backend looks would just mean the new location starts out empty and looks like the old data
// vanished, even though — on THIS SAME machine, before any reinstall — it's still sitting right there at
// the old bundle-relative path. A version genuinely reinstalled via a fresh Finder "Replace" has already
// lost the old bundle's contents before this code ever runs; there's no way to recover that after the fact,
// which is exactly why this fix needs to ship BEFORE that replace happens, not after.
function migrateLegacyDataDir(newDir: string): void {
  logToFile(`migrateLegacyDataDir: start, isPackaged=${app.isPackaged}, newDir=${newDir}`);
  // Not app.isPackaged: this build's Electron shell is never actually re-packaged (default_app.asar and
  // the "Electron" executable name are both still present in Contents/Resources), so Electron's own
  // isPackaged heuristic reports false even for a real installed .app — it's not a reliable dev/prod signal
  // here. legacyBackendDir's existence is: a real install has process.resourcesPath/backend, a dev run
  // (resourcesPath inside node_modules/electron's own Resources) never does.
  fs.mkdirSync(newDir, { recursive: true }); // always, even a genuinely fresh install with nothing to migrate — the
  // backend's very first write (getDeviceIdentity's device.json) throws ENOENT if this dir doesn't exist yet.

  const alreadyMigrated = fs.existsSync(path.join(newDir, 'devices.json')) || fs.existsSync(path.join(newDir, 'accounts.json'));
  logToFile(`migrateLegacyDataDir: alreadyMigrated=${alreadyMigrated}`);
  if (alreadyMigrated) return;

  const legacyBackendDir = path.join(process.resourcesPath, 'backend');
  const legacyEnvPath = path.join(process.resourcesPath, '..', '.env');
  logToFile(`migrateLegacyDataDir: legacyBackendDir=${legacyBackendDir} exists=${fs.existsSync(legacyBackendDir)}, legacyEnvPath=${legacyEnvPath} exists=${fs.existsSync(legacyEnvPath)}`);
  try {
    if (fs.existsSync(legacyBackendDir)) {
      const entries = fs.readdirSync(legacyBackendDir, { withFileTypes: true });
      logToFile(`migrateLegacyDataDir: legacyBackendDir entries=${entries.map((e) => e.name).join(', ')}`);
      for (const entry of entries) {
        // dist/node_modules are shipped code, not user data — never part of what gets carried over.
        if (entry.name === 'dist' || entry.name === 'node_modules') continue;
        fs.cpSync(path.join(legacyBackendDir, entry.name), path.join(newDir, entry.name), { recursive: true });
      }
      logToFile(`migrated legacy runtime data from ${legacyBackendDir} to ${newDir}`);
    }
    if (fs.existsSync(legacyEnvPath)) {
      fs.copyFileSync(legacyEnvPath, path.join(newDir, '.env'));
      logToFile(`migrated legacy .env from ${legacyEnvPath} to ${newDir}`);
    }
  } catch (err) {
    logToFile(`legacy data migration failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function spawnBackend(): void {
  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'dist', 'index.js')
    : path.join(__dirname, '../../../backend/dist/index.js');

  const dataDir = path.join(app.getPath('userData'), 'backend-data');
  migrateLegacyDataDir(dataDir);

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  backendProcess = spawn(process.execPath, [backendEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ALLIMINATE_DATA_DIR: dataDir,
      // the backend is a plain Node child process with no Electron runtime, so it can't call
      // app.getPath() itself for the local-folder-browsing feature's known folders — resolve them here
      // (correct even if the user relocated one via the registry/Finder) and hand them down as env vars.
      ALLIMINATE_FOLDER_DESKTOP: app.getPath('desktop'),
      ALLIMINATE_FOLDER_DOWNLOADS: app.getPath('downloads'),
      ALLIMINATE_FOLDER_DOCUMENTS: app.getPath('documents'),
      ALLIMINATE_FOLDER_PICTURES: app.getPath('pictures'),
      ALLIMINATE_FOLDER_VIDEOS: app.getPath('videos'),
      ALLIMINATE_FOLDER_MUSIC: app.getPath('music'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess.stdout?.pipe(logStream);
  backendProcess.stderr?.pipe(logStream);

  // once this attempt actually comes up, the backoff resets — a crash hours into a healthy run shouldn't
  // inherit a long delay meant for a repeatedly-failing boot-time start.
  (async () => {
    for (let i = 0; i < 40; i++) {
      if (await isPortOpen(BACKEND_PORT)) {
        backendRestarts = 0;
        if (pendingCrashMessage) {
          const message = pendingCrashMessage;
          pendingCrashMessage = null;
          fetch('http://localhost:4310/logs/automated', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          }).catch(() => {}); // best-effort — losing an automated log entry isn't worth retry complexity
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  // previously nothing ever noticed if this process died — the app would just sit on "backend
  // unreachable" forever until the user manually quit and relaunched. Auto-restart it with exponential
  // backoff (capped at 30s between attempts) — deliberately NEVER gives up permanently. A boot-time
  // failure (disk/keychain/network not warm yet right after login, exactly when a launch-at-login app is
  // most likely to start) can easily take longer than a few seconds to clear on its own; a hard restart
  // cap reintroduces the same "stuck unreachable forever" bug this was meant to fix, just delayed by a
  // few seconds. A genuinely broken backend just means occasional low-overhead retries, not a crash loop.
  backendProcess.on('exit', (code, signal) => {
    logToFile(`backend exited (code=${code}, signal=${signal})`);
    backendProcess = null;
    if (quitting) return;
    pendingCrashMessage = `Backend process exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}) and was automatically restarted.`;
    backendRestarts += 1;
    const delay = Math.min(BACKEND_RESTART_MAX_DELAY_MS, 1000 * 2 ** Math.min(backendRestarts - 1, 5));
    logToFile(`restarting backend (attempt ${backendRestarts}) in ${delay}ms`);
    setTimeout(spawnBackend, delay);
  });
}

async function ensureBackend(): Promise<void> {
  if (await isPortOpen(BACKEND_PORT)) return; // already running (e.g. started manually in dev)

  spawnBackend();

  // give it a moment to bind before the renderer starts hitting it — a slow boot (disk/keychain not
  // fully warm yet, common right after login) can push this past a few seconds, so this only affects how
  // long we wait here before continuing; spawnBackend's own exit handler keeps retrying independently of
  // this loop either way.
  for (let i = 0; i < 40; i++) {
    if (await isPortOpen(BACKEND_PORT)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

let mainWindow: BrowserWindow | null = null;

function createMainWindow(navigateTo?: string): void {
  const preload = path.join(__dirname, '../preload/index.js');
  const win =
    process.platform === 'darwin' ? createMacWindow(preload) : createWindowsWindow(preload);

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // window starts hidden (show:false in the platform window builders) — reveal it only once the
  // renderer has actually painted a first frame, so a cold boot never shows a blank vibrancy window with
  // the desktop bleeding through while React is still loading.
  win.once('ready-to-show', () => win.show());
  // belt-and-suspenders: if 'ready-to-show' never fires for some reason (a wedged renderer), don't leave
  // the window invisible forever — show it after a few seconds regardless so the user at least sees
  // whatever state it's actually in instead of nothing.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 5000);

  // renderer is static for now (no bundler yet) — served straight from src.
  win.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  // window was just created (not shown from a hidden state) — the renderer isn't ready for IPC yet, so
  // the tray's "View Files"/"View Devices" link has to wait for the first paint before it can navigate.
  if (navigateTo) {
    win.webContents.once('did-finish-load', () => win.webContents.send('app:navigate', navigateTo));
  }
}

export function showMainWindow(navigateTo?: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (navigateTo) mainWindow.webContents.send('app:navigate', navigateTo);
  } else {
    createMainWindow(navigateTo);
  }
}

ipcMain.handle('security:isEnabled', () => isAppLockEnabled());
ipcMain.handle('security:setEnabled', (_e, enabled: boolean, pin?: string) => {
  setAppLockEnabled(enabled, pin);
});
ipcMain.handle('security:verifyPin', (_e, pin: string) => verifyPin(pin));
ipcMain.handle('security:canTouchID', () => canUseTouchID());
ipcMain.handle('security:tryTouchID', () => tryTouchID());

ipcMain.handle('launchAtLogin:isEnabled', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('launchAtLogin:setEnabled', (_e, enabled: boolean) => {
  // A packaged app (Mac's own build-app.sh output, or an eventual Windows equivalent) needs nothing extra
  // here — process.execPath already points at a self-contained bundle that loads its own app content by
  // Electron's normal convention. An UNPACKAGED dev run (bare `electron.exe path-to-app`, which is how
  // this app currently runs on Windows — no build-app.sh equivalent exists there yet) is different:
  // process.execPath is just electron.exe with no idea which app to load, so a login item registered
  // without the app path launches Electron's own default template window instead of AllieMinate. Passing
  // the app directory as an explicit arg is exactly what the manual `electron.exe path-to-app` invocation
  // already does — this just makes Windows' boot-time launch do the same thing.
  if (!app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [app.getAppPath()] });
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
});

ipcMain.handle('usb:connect', () => connectUsbTunnel());
ipcMain.handle('usb:launchPairDeepLink', (_e, code: string, macName: string) => launchPairDeepLink(code, macName));

// Transfer History context menu — these files already live on this Mac's disk (a real local path from
// the moment they were logged), so "Copy" and "Show in Finder" are plain OS operations, no download step.
ipcMain.handle('file:showInFinder', (_e, filePath: string) => {
  shell.showItemInFolder(filePath);
});
// Sync Engine "Open Folder in Finder" — opens the folder's OWN contents in a new Finder window, unlike
// showInFinder above which reveals a file selected inside its PARENT folder (the right behavior for a file,
// the wrong one for "show me what's in this synced folder").
ipcMain.handle('file:openFolder', (_e, folderPath: string) => shell.openPath(folderPath));
ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url));
ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('mail:composeWithAttachments', (_e, params: { to: string; subject: string; body: string; attachmentPaths: string[] }) =>
  composeMailWithAttachments(params),
);

ipcMain.handle('dialog:pickFolder', async () => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return { canceled: result.canceled, path: result.filePaths[0] };
});

ipcMain.handle('file:copyLocal', (_e, filePath: string) => {
  if (!fs.existsSync(filePath)) return { ok: false, error: 'file no longer exists at that path' };
  clipboard.writeBuffer('public.file-url', Buffer.from(`file://${encodeURI(filePath)}`, 'utf-8'));
  return { ok: true };
});

// Universal Clipboard — the renderer polls readText() and calls writeText() when it sees a real change
// (its own or a peer's); the actual OS clipboard access has to happen here since the backend is a plain
// Node child process with no Electron API (see clipboard.ts's own comment on that).
ipcMain.handle('clipboard:readText', () => clipboard.readText());
ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  clipboard.writeText(text);
});

app.whenReady().then(async () => {
  // nothing in this app ever calls app.dock.hide() — the Dock icon (and macOS's own "running" indicator
  // dot under it) should always be present regardless of whether the main window is open or the app is
  // sitting tray-only. Making that explicit here means it can't silently regress if something upstream
  // (a future change, a stale Electron default) ever hides it without anyone noticing.
  if (process.platform === 'darwin') app.dock?.show();
  await ensureBackend();
  createMainWindow();
  createTray();
  if (pendingShareUrl) {
    handleShareExtensionUrl(pendingShareUrl);
    pendingShareUrl = null;
  }
});

// this app keeps running via the tray after the main window closes on every platform (see spawnBackend's
// comment above) — quitting is user-driven via the tray's Quit item (or Cmd+Q's default app-menu handler
// on macOS), not a side effect of closing the last window.
app.on('window-all-closed', () => {});

// fires in the FIRST process when a second launch attempt happens — bring the existing window forward
// instead of leaving the user staring at nothing while a doomed second process spins up and quits.
app.on('second-instance', () => {
  showMainWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('before-quit', () => {
  quitting = true;
  backendProcess?.kill();
  disconnectUsbTunnel();
});
