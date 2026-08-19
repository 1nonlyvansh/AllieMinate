import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';

// Electron's cross-platform `clipboard` module has no way to write a real file reference on Windows —
// `clipboard.writeBuffer('public.file-url', ...)` (what the Mac side uses) is a macOS-only pasteboard UTI;
// writing it here does nothing useful, which is why "Copy" silently produced nothing pasteable on Windows.
// Windows' actual equivalent is the CF_HDROP clipboard format, which Chromium's clipboard API can't write
// directly (a custom string format name like 'CF_HDROP' just registers a new, unrecognized format — it
// doesn't map to the predefined numeric CF_HDROP constant). PowerShell's own `Set-Clipboard -LiteralPath`
// already does this correctly (it's the same thing Explorer puts on the clipboard for Ctrl+C on a file), so
// shelling out to it avoids pulling in a native addon just for this one call.
// Use base64-encoded command to avoid any injection/escaping issues with special characters in paths.
export function copyFileToWindowsClipboard(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const psCommand = `Set-Clipboard -LiteralPath '${filePath.replace(/'/g, "''")}'`;
    const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}
