import { BrowserWindow } from 'electron';

// Electron's built-in zoom accelerator (the implicit default menu's View > Zoom In/Out/Actual Size roles)
// is asymmetric across keyboards in practice — Zoom Out (a bare, unshifted "-") reliably fires, but Zoom
// In's "+" is the shifted character of "=" on most layouts and the built-in accelerator regularly misses
// it, leaving a window stuck zoomed out with no way back in from the keyboard. Handling it ourselves here
// covers both the "=" and "+" keys (and numpad, which reports the same `key` values) so it works
// regardless of layout, and doesn't depend on whatever the platform's implicit default menu does.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -8;
const ZOOM_MAX = 8;

export function registerZoomShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;

    const contents = win.webContents;
    if (input.key === '=' || input.key === '+') {
      event.preventDefault();
      contents.zoomLevel = Math.min(ZOOM_MAX, contents.zoomLevel + ZOOM_STEP);
    } else if (input.key === '-' || input.key === '_') {
      event.preventDefault();
      contents.zoomLevel = Math.max(ZOOM_MIN, contents.zoomLevel - ZOOM_STEP);
    } else if (input.key === '0') {
      event.preventDefault();
      contents.zoomLevel = 0;
    }
  });
}
