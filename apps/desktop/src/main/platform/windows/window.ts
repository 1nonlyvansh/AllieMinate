import { BrowserWindow, nativeTheme, shell } from 'electron';
import { injectThemeCss } from '../injectTheme';

function overlayOptions(): Electron.TitleBarOverlay {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#00000000', symbolColor: '#ffffff', height: 40 }
    : { color: '#00000000', symbolColor: '#000000', height: 40 };
}

export function createWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayOptions(),
    backgroundColor: '#00000000',
    // shown only once the renderer has actually painted (see createMainWindow's 'ready-to-show') — same
    // blank-frame-on-cold-boot issue as the Mac window, same fix.
    show: false,
    // Electron throttles setTimeout/setInterval hard in an unfocused/backgrounded renderer — every
    // reconnect/poll loop here (backend retry, WebSocket reconnect, tray/devices/search polls) rides plain
    // timers, so a backend blip that lines up with the window losing focus could sit "unreachable" long
    // after the backend actually recovered, purely because the timer that would notice never got to fire.
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  nativeTheme.on('updated', () => win.setTitleBarOverlay(overlayOptions()));

  injectThemeCss(win, 'windows/fluent.css');

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}
