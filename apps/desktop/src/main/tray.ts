import { Tray, BrowserWindow, nativeImage, screen, ipcMain, clipboard, Menu, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { injectThemeCss } from './platform/injectTheme';
import { showMainWindow } from './index';

const API_BASE = 'http://localhost:4310';
let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let pendingDropFiles: string[] | null = null;
let pendingDropKind: 'cloud' | 'device' | 'nearby' | 'both' = 'both';
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null;

const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
};

interface FolderInfo {
  id: string;
  name: string;
  provider: string;
  remotePrefix: string;
  displayName: string;
}
interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  nearbyShareEnabled?: boolean;
}
interface FileProgress {
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
}
interface PanelState {
  mode: 'recent' | 'drop';
  folders?: FolderInfo[];
  devices?: PairedDevice[];
  nearbyPeers?: NearbyPeer[];
  fileNames?: string[];
  kind?: 'cloud' | 'device' | 'nearby' | 'both';
  status?: 'idle' | 'sending' | 'done';
  sentTo?: string;
  progress?: FileProgress[];
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type ProgressCallback = (index: number, status: FileProgress['status']) => void;

// each fetch gets its own timeout so one stuck upload can't leave the panel parked on "Sending" forever —
// it's reported as an error for that file and the batch moves on to the rest.
const UPLOAD_TIMEOUT_MS = 60_000;

async function uploadDroppedFiles(filePaths: string[], folderId: string, onProgress: ProgressCallback): Promise<void> {
  for (let i = 0; i < filePaths.length; i++) {
    onProgress(i, 'uploading');
    try {
      const data = await fs.readFile(filePaths[i]);
      const name = path.basename(filePaths[i]);
      const res = await fetch(`${API_BASE}/folders/${folderId}/upload?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      onProgress(i, res.ok ? 'done' : 'error');
    } catch {
      onProgress(i, 'error');
    }
  }
}

// lands straight in the peer's own inbox (Received on Mac/PC) — same /devices/:id/share route ShareModal
// uses, no cloud-folder destination needed (see devices.ts's own comment on that route for why it used
// to require one and why that was wrong for a straight device-to-device drop).
async function shareDroppedFiles(filePaths: string[], deviceId: string, onProgress: ProgressCallback): Promise<void> {
  for (let i = 0; i < filePaths.length; i++) {
    onProgress(i, 'uploading');
    try {
      const bytes = await fs.readFile(filePaths[i]);
      const name = path.basename(filePaths[i]);
      const res = await fetch(`${API_BASE}/devices/${deviceId}/share?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      onProgress(i, res.ok ? 'done' : 'error');
    } catch {
      onProgress(i, 'error');
    }
  }
}

// /nearby/send can legitimately take up to ~60s just waiting for the receiver to tap Accept/Decline (see
// the backend's own deadline) before it even starts the actual upload — give it real headroom instead of
// the normal 60s upload timeout, which could fire right as a slow-to-respond human was about to accept.
const NEARBY_SEND_TIMEOUT_MS = 90_000;

async function shareNearbyFiles(filePaths: string[], peerId: string, onProgress: ProgressCallback): Promise<void> {
  for (let i = 0; i < filePaths.length; i++) {
    onProgress(i, 'uploading');
    try {
      const bytes = await fs.readFile(filePaths[i]);
      const name = path.basename(filePaths[i]);
      const res = await fetch(`${API_BASE}/nearby/send?peerId=${encodeURIComponent(peerId)}&name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
        signal: AbortSignal.timeout(NEARBY_SEND_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      onProgress(i, res.ok && data.status === 'sent' ? 'done' : 'error');
    } catch {
      onProgress(i, 'error');
    }
  }
}

interface NearbyPeer {
  id: string;
  name: string;
  platform: string;
}

async function fetchDropTargets(): Promise<{ folders: FolderInfo[]; devices: PairedDevice[]; nearbyPeers: NearbyPeer[] }> {
  const [statusData, devicesData, accountsData, nearbyData] = await Promise.all([
    fetchJson<{ folders: Omit<FolderInfo, 'displayName'>[] }>(`${API_BASE}/status`),
    fetchJson<{ paired: PairedDevice[] }>(`${API_BASE}/devices`),
    fetchJson<{ accounts: { accountId: string; label: string }[] }>(`${API_BASE}/accounts`),
    fetchJson<{ nearby: NearbyPeer[] }>(`${API_BASE}/devices/nearby`),
  ]);

  const driveLabels = new Map((accountsData?.accounts ?? []).map((a) => [a.accountId, a.label]));

  const folders = (statusData?.folders ?? [])
    .filter((f) => f.remotePrefix !== '*')
    .map((f) => {
      const base = f.provider.split(':')[0];
      const displayName =
        base === 'google-drive' ? driveLabels.get(f.provider) ?? 'Google Drive' : PROVIDER_DISPLAY_NAME[base] ?? f.provider;
      return { ...f, displayName };
    });

  return {
    folders,
    devices: (devicesData?.paired ?? []).filter((d) => d.online),
    nearbyPeers: nearbyData?.nearby ?? [],
  };
}

function sendPanelState(state: PanelState): void {
  panel?.webContents.send('tray:state', state);
}

function createPanel(): BrowserWindow {
  const preload = path.join(__dirname, '../preload/index.js');
  const win = new BrowserWindow({
    width: 368,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'popover',
    visualEffectState: 'active',
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    // this panel spends most of its life hidden (shown only on a menu-bar click) — background throttling
    // would otherwise starve its device/nearby-peer polling exactly while it's not visible, so it'd show
    // stale data for a beat right after opening instead of already being current.
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // glass.css (not windows/fluent.css) on purpose here — it's the only stylesheet with the .tray-panel/
  // .tray-drop-* classes this panel actually uses; its dark flyout look has no vibrancy/blur dependency,
  // so it renders correctly on Windows as a plain solid-dark popup without needing a Windows equivalent.
  injectThemeCss(win, 'mac/glass.css');
  win.loadFile(path.join(__dirname, '../../src/renderer/trayPanel.html'));

  win.on('blur', () => {
    if (!pendingDropFiles) win.hide();
  });
  return win;
}

const PANEL_WIDTH = 368;
const PANEL_HEIGHT = 480;

// macOS always has the tray icon in a top menu bar, so "panel appears below the icon" was a safe
// assumption. Windows' taskbar (and tray icon with it) is usually bottom-anchored but can be dragged to
// any of the four screen edges — so instead of assuming an edge, diff the display's full bounds against
// its workArea to find which side is actually occluded by the taskbar/menu bar, then place the panel on
// the opposite side of the tray icon from that edge, clamped within the visible work area on both axes.
function positionPanelNearTray(win: BrowserWindow): void {
  if (!tray) return;
  const trayBounds = tray.getBounds();
  const { bounds, workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  // zero — any real gap here is a dead zone with no window coverage at all, and the cursor crossing it
  // between the tray's 'mouse-leave' and the panel's 'mouse-enter' is what let the hide timer fire before
  // the panel ever caught the hover. The panel's edge should touch the tray icon's bounds exactly; the
  // debounce timer (see scheduleHideDropPanel) is what actually absorbs the crossing, not extra geometry.
  const gap = 0;

  const topGap = workArea.y - bounds.y;
  const bottomGap = bounds.y + bounds.height - (workArea.y + workArea.height);
  const leftGap = workArea.x - bounds.x;
  const rightGap = bounds.x + bounds.width - (workArea.x + workArea.width);
  const maxGap = Math.max(topGap, bottomGap, leftGap, rightGap);

  let x: number;
  let y: number;
  if (maxGap === leftGap && leftGap > 0) {
    x = trayBounds.x + trayBounds.width + gap;
    y = Math.round(trayBounds.y + trayBounds.height / 2 - PANEL_HEIGHT / 2);
  } else if (maxGap === rightGap && rightGap > 0) {
    x = trayBounds.x - PANEL_WIDTH - gap;
    y = Math.round(trayBounds.y + trayBounds.height / 2 - PANEL_HEIGHT / 2);
  } else if (maxGap === bottomGap && bottomGap > 0) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - PANEL_WIDTH / 2);
    y = trayBounds.y - PANEL_HEIGHT - gap;
  } else {
    // top taskbar/menu bar (macOS default) or no edge detected — panel appears below the icon
    x = Math.round(trayBounds.x + trayBounds.width / 2 - PANEL_WIDTH / 2);
    y = trayBounds.y + trayBounds.height + gap;
  }

  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - PANEL_WIDTH - 8));
  y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - PANEL_HEIGHT - 8));

  win.setPosition(Math.round(x), Math.round(y), false);
}

// hover shows the panel as a preview (no OS focus stolen — showInactive), independent of the drag/drop
// flow's own show/hide calls. Reuses the same dragLeaveTimer/scheduleHideDropPanel grace-period pair the
// drag flow already relies on (renderer sends 'tray:keepPanelOpen' on entering the panel content, and a
// new 'tray:panelHoverLeave' on leaving it) rather than polling cursor position against tray/panel bounds
// — a poll-based approach is fooled by Windows display-scaling mismatches between screen.getCursorScreenPoint()
// and Tray.getBounds(), which is exactly what made the panel flash and vanish on the first hover attempt.
function showPanelOnHover(): void {
  if (!tray) return;
  if (!panel || panel.isDestroyed()) panel = createPanel();
  positionPanelNearTray(panel);
  if (!panel.isVisible()) {
    panel.showInactive();
    // plain reload() can still serve the JS bundle and any GET responses from Chromium's HTTP cache — this
    // panel needs to reflect settings the user may have JUST changed (Menu Bar Icon Settings' cloud filter,
    // for one), so a normal reload isn't enough; force a real re-fetch of everything, bundle included.
    panel.webContents.reloadIgnoringCache();
  }
}

function clearDragLeaveTimer(): void {
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer);
    dragLeaveTimer = null;
  }
}

async function showDropPanel(): Promise<void> {
  if (!tray) return;
  clearDragLeaveTimer();
  if (!panel || panel.isDestroyed()) panel = createPanel();
  positionPanelNearTray(panel);
  panel.show();

  const { folders, devices, nearbyPeers } = await fetchDropTargets();
  sendPanelState({ mode: 'drop', folders, devices, nearbyPeers, fileNames: pendingDropFiles ?? [], kind: pendingDropKind, status: 'idle' });
}

function scheduleHideDropPanel(): void {
  clearDragLeaveTimer();
  dragLeaveTimer = setTimeout(() => {
    dragLeaveTimer = null;
    if (!pendingDropFiles && panel && !panel.isDestroyed()) panel.hide();
  }, 200);
}

function handleFilesDropped(filePaths: string[], kind: 'cloud' | 'device' | 'nearby' | 'both' = 'both'): void {
  pendingDropFiles = filePaths;
  pendingDropKind = kind;
  showDropPanel();
}

function cancelDrop(): void {
  pendingDropFiles = null;
  pendingDropKind = 'both';
  clearDragLeaveTimer();
  panel?.hide();
}

// same temp file backs "Copy" (clipboard) and native drag-out (startDrag needs a real local path) —
// cached by URL so dragging right after copying (or vice versa) doesn't re-download.
const tempFileCache = new Map<string, string>();

// dedicated, OS-appropriate cache directory — this used to land straight in the shared OS temp folder
// with nothing ever cleaning it up. Resolved lazily (not at module load) so it picks up app.setName()'s
// corrected app identity, which index.ts sets before ever touching the tray; on Windows this explicitly
// targets %LOCALAPPDATA% (cache is disposable/regenerable, it shouldn't roam), falling back to the
// standard per-OS userData location elsewhere (already ~/Library/Application Support/AllieMinate on mac).
let trayCacheDirPromise: Promise<string> | null = null;
function ensureTrayCacheDir(): Promise<string> {
  if (!trayCacheDirPromise) {
    const base = process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, app.getName())
      : app.getPath('userData');
    const dir = path.join(base, 'FileCache');
    trayCacheDirPromise = fs.mkdir(dir, { recursive: true }).then(() => dir);
  }
  return trayCacheDirPromise;
}

async function downloadToTemp(url: string, filename: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const cached = tempFileCache.get(url);
  if (cached) return { ok: true, path: cached };
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `download failed (${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    const cacheDir = await ensureTrayCacheDir();
    const tempPath = path.join(cacheDir, `${Date.now()}-${filename}`);
    await fs.writeFile(tempPath, buf);
    tempFileCache.set(url, tempPath);
    return { ok: true, path: tempPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildTrayContextMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Open AllieMinate', click: () => { panel?.hide(); showMainWindow(); } },
    { type: 'separator' },
    { label: 'Quit AllieMinate', click: () => app.quit() },
  ]);
}

export function createTray(): void {
  // source asset is a 22px/44px@2x macOS menu-bar icon; Windows' notification-area convention is a
  // smaller 16px square, so shrink it at runtime rather than shipping a separate pre-baked asset.
  let icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/trayIcon.png'));
  if (process.platform === 'win32') icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('AllieMinate');

  ipcMain.handle('tray:openApp', (_e, target?: string) => {
    panel?.hide();
    showMainWindow(target);
  });

  // "Copy" under a Recent Cloud/Device file thumbnail — downloads it to a temp file, then puts a real
  // file reference (not just text) on the pasteboard so a Cmd+V in Finder/Mail/anywhere actually pastes
  // the file, same as copying a file in Finder itself.
  ipcMain.handle('tray:copyFile', async (_e, url: string, filename: string) => {
    const result = await downloadToTemp(url, filename);
    if (!result.ok || !result.path) return result;
    clipboard.writeBuffer('public.file-url', Buffer.from(`file://${encodeURI(result.path)}`, 'utf-8'));
    return { ok: true };
  });

  // native OS drag-out — pre-downloads to the same temp cache so it's ready by the time dragstart fires
  // (startDrag needs a real local path synchronously; there's no way to await a download mid-drag).
  ipcMain.handle('tray:prepareFileForDrag', async (_e, url: string, filename: string) => downloadToTemp(url, filename));

  ipcMain.on('tray:startFileDrag', (event, filePath: string) => {
    event.sender.startDrag({ file: filePath, icon: path.join(__dirname, '../../assets/trayIcon@2x.png') });
  });

  ipcMain.handle('tray:cancelDrop', () => {
    cancelDrop();
  });

  // the panel content reports its own hover state so we don't auto-hide while the cursor is over it, not
  // just over the tiny tray icon — shared by the drag flow (matches O+ Connect's drop-anywhere-in-the-panel
  // behavior) and by plain mouse hover, since both just mean "the user is still interacting with this".
  ipcMain.handle('tray:keepPanelOpen', () => {
    clearDragLeaveTimer();
  });

  ipcMain.handle('tray:panelHoverLeave', () => {
    scheduleHideDropPanel();
  });

  ipcMain.handle('tray:filesDroppedInPanel', (_e, filePaths: string[], kind?: 'cloud' | 'device' | 'nearby') => {
    handleFilesDropped(filePaths, kind ?? 'both');
  });

  // user dropped into the wrong half of the panel (Cloud Transfer vs Devices) — flip which section
  // shows without re-dropping, same pending files.
  ipcMain.handle('tray:switchDropKind', (_e, kind: 'cloud' | 'device') => {
    pendingDropKind = kind;
    sendPanelState({ mode: 'drop', kind });
  });

  // the drag left the panel's own bounds without dropping — schedule the same grace-period hide
  // used when it leaves the tray icon, so the panel doesn't stay stuck open forever.
  ipcMain.handle('tray:panelDragLeave', () => {
    scheduleHideDropPanel();
  });

  ipcMain.handle('tray:completeDrop', async (_e, kind: 'folder' | 'device' | 'nearby', id: string) => {
    const files = pendingDropFiles;
    if (!files) return;

    const progress: FileProgress[] = files.map((f) => ({ name: path.basename(f), status: 'pending' }));
    sendPanelState({ mode: 'drop', status: 'sending', progress: [...progress] });

    const onProgress: ProgressCallback = (index, status) => {
      progress[index] = { ...progress[index], status };
      sendPanelState({ mode: 'drop', status: 'sending', progress: [...progress] });
    };

    let targetName = '';
    if (kind === 'folder') {
      const { folders } = await fetchDropTargets();
      targetName = folders.find((f) => f.id === id)?.displayName ?? 'folder';
      await uploadDroppedFiles(files, id, onProgress);
    } else if (kind === 'nearby') {
      const { nearbyPeers } = await fetchDropTargets();
      targetName = nearbyPeers.find((p) => p.id === id)?.name ?? 'device';
      await shareNearbyFiles(files, id, onProgress);
    } else {
      const { devices } = await fetchDropTargets();
      targetName = devices.find((d) => d.id === id)?.name ?? 'device';
      await shareDroppedFiles(files, id, onProgress);
    }

    pendingDropFiles = null;
    sendPanelState({ mode: 'drop', status: 'done', sentTo: targetName, progress: [...progress] });
  });

  // hovering previews the panel (recent files, quick actions); clicking opens the full app window instead
  // of toggling the panel — the panel is a glanceable preview, not the click target.
  tray.on('mouse-enter', () => {
    clearDragLeaveTimer();
    showPanelOnHover();
  });

  tray.on('mouse-leave', () => {
    scheduleHideDropPanel();
  });

  tray.on('click', () => {
    panel?.hide();
    clearDragLeaveTimer();
    showMainWindow();
  });

  // Windows convention: right-click shows a context menu (there's no Dock/Cmd+Q route to quit on
  // Windows, so this is also the only in-UI way to quit there — worth having on macOS too).
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildTrayContextMenu());
  });

  // macOS-only: fires while a Finder drag hovers over the tray icon, before drop.
  tray.on('drag-enter', () => {
    pendingDropKind = 'both';
    showDropPanel();
  });

  tray.on('drag-leave', () => {
    scheduleHideDropPanel();
  });

  tray.on('drop-files', (_event, filePaths) => {
    handleFilesDropped(filePaths);
  });
}
