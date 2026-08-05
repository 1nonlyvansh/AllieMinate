import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';

// renderer is static (no bundler for styles) — main process picks the right
// platform stylesheet and injects it, so index.html itself stays platform-agnostic.
export function injectThemeCss(win: BrowserWindow, cssRelPath: string): void {
  const cssPath = path.join(__dirname, '../../../src/renderer/styles', cssRelPath);

  win.webContents.on('did-finish-load', () => {
    const css = fs.readFileSync(cssPath, 'utf-8');
    win.webContents.insertCSS(css);
  });
}
