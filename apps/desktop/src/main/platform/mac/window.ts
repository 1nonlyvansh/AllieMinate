import { BrowserWindow, shell } from 'electron';
import { injectThemeCss } from '../injectTheme';
import { registerZoomShortcuts } from '../zoomShortcuts';

export function createWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#00000000',
    // window created hidden, shown only on 'ready-to-show' (see createMainWindow) — a translucent
    // vibrancy window shown immediately, before the renderer paints anything, can sit as a blank black
    // frame with the desktop bleeding through for several seconds on a cold boot (disk/GPU/compositor not
    // warm yet, exactly when a launch-at-login app is most likely to start) — no error, just nothing.
    show: false,
    // this window is translucent (vibrancy + transparent background) — clicking the green traffic light
    // otherwise triggers a real macOS fullscreen Space transition, and translucent NSWindows have a known
    // rendering glitch during that transition where the menu bar area briefly renders solid black instead
    // of reappearing normally. fullscreenable:false makes the green button do a plain "zoom to fill the
    // screen" (the same as double-clicking any classic Mac window's title bar) instead of entering a
    // fullscreen Space, which sidesteps that transition entirely — the window still fills the screen, it
    // just never becomes an immersive fullscreen Space.
    fullscreenable: false,
    // Electron throttles setTimeout/setInterval hard (down to roughly once a minute) in a renderer that
    // isn't the focused/visible window — every reconnect/poll loop in the renderer (App.tsx's backend
    // retry, its WebSocket reconnect, the tray/devices/search polls) rides plain timers, so a backend blip
    // that happens to line up with the window being backgrounded (alt-tabbed away, minimized, occluded)
    // could sit "unreachable" for a long time even after the backend actually recovered, because the very
    // timer meant to notice that just wasn't allowed to fire. This app talks to a local backend the whole
    // point is to stay live with, so that throttling is never the right tradeoff here.
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  injectThemeCss(win, 'mac/glass.css');
  registerZoomShortcuts(win);

  // online-editor links (Google Sheets/Docs, Office Online, etc) should open in the user's real
  // browser — that's where they're actually signed in — not a session-less Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}
