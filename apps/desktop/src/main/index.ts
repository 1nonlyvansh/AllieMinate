import { app, BrowserWindow, ipcMain, shell, clipboard, dialog } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { createWindow as createMacWindow } from './platform/mac/window';
import { createWindow as createWindowsWindow } from './platform/windows/window';
import { createTray } from './tray';
import { isAppLockEnabled, setAppLockEnabled, verifyPin, canUseTouchID, tryTouchID } from './security';
import { connectUsbTunnel, disconnectUsbTunnel, launchPairDeepLink } from './adb';
import { composeMailWithAttachments } from './mail';

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

function spawnBackend(): void {
  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'dist', 'index.js')
    : path.join(__dirname, '../../../backend/dist/index.js');

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  backendProcess = spawn(process.execPath, [backendEntry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
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
  app.setLoginItemSettings({ openAtLogin: enabled });
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

app.whenReady().then(async () => {
  // nothing in this app ever calls app.dock.hide() — the Dock icon (and macOS's own "running" indicator
  // dot under it) should always be present regardless of whether the main window is open or the app is
  // sitting tray-only. Making that explicit here means it can't silently regress if something upstream
  // (a future change, a stale Electron default) ever hides it without anyone noticing.
  if (process.platform === 'darwin') app.dock?.show();
  await ensureBackend();
  createMainWindow();
  if (process.platform === 'darwin') createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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
