import { execFile, spawn } from 'node:child_process';

/** Opens a URL in the system default browser — backend has no Electron `shell.openExternal`, so this is
 * the Node-side equivalent, used only for the OAuth consent-flow redirect. Array-form execFile (no shell
 * string interpolation) so the URL can't be parsed as extra shell syntax on either platform. */
export function openExternalUrl(url: string): void {
  if (process.platform === 'win32') {
    // cmd's `start` treats its first quoted argument as a window title, not the thing to open — the
    // empty '' is a required placeholder, not a typo.
    execFile('cmd', ['/c', 'start', '', url]);
    return;
  }
  execFile('open', [url]);
}

/** Launches a local file with a specific app (appPath) or the OS default handler (no appPath) — the
 * macOS `open` command has no Windows equivalent binary, so this branches per platform instead of
 * shelling out to a single cross-platform command. */
export function openLocalFile(filePath: string, appPath: string | undefined, onError: (err: Error) => void): void {
  if (process.platform === 'win32') {
    // most Windows apps accept a file path as a plain positional argument; with no specific app, explorer
    // handing the path back to itself invokes the same registered default handler `start`/Explorer would.
    const child = spawn(appPath ?? 'explorer', [filePath], { detached: true, stdio: 'ignore' });
    child.on('error', onError);
    child.unref();
    return;
  }

  const args = appPath ? ['-a', appPath, filePath] : [filePath];
  execFile('open', args, (err) => {
    if (err) onError(err);
  });
}
