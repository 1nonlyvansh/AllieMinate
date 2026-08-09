import { execFile, spawn } from 'node:child_process';

/** Opens a URL in the system default browser — backend has no Electron `shell.openExternal`, so this is
 * the Node-side equivalent, used only for the OAuth consent-flow redirect. Array-form execFile/spawn (no
 * shell string interpolation) so the URL can't be parsed as extra shell syntax on either platform. */
export function openExternalUrl(url: string): void {
  if (process.platform === 'win32') {
    // Two dead ends before this one, for the record:
    // - `cmd /c start` — cmd.exe re-parses its own command line once it receives it (regardless of being
    //   spawned via an argv array, not a shell string) and treats a bare `&` as a command separator,
    //   silently truncating the URL at the first one. Every OAuth authUrl here has several
    //   (?client_id=...&response_type=...&...), so this cut the URL down to just `?client_id=...` — the
    //   "missing response_type" / "invalid_request" error that produced.
    // - `explorer.exe <url>` — works for opening a local file/folder (see openLocalFile below), but recent
    //   Windows versions restrict explorer.exe's own URL-launching behavior (a hardening change against
    //   using it as a UAC-bypass vector), so instead of invoking the browser it just opens a plain
    //   Explorer window and ignores the URL.
    // rundll32's url.dll,FileProtocolHandler is the actual standard, still-supported technique for this —
    // it hands the string straight to ShellExecute for the registered browser with no command-line
    // re-parsing of its own (the url is one argv element, not something rundll32 re-splits).
    execFile('rundll32', ['url.dll,FileProtocolHandler', url]);
    return;
  }
  execFile('open', [url]);
}

// a stored Open-With preference is a bare string (see openWith.ts's saveOpenWithPref) — for a UWP/Store
// app (openWith.win.ts's getAvailableApps returning kind:'uwp'), that string is an AppUserModelID like
// "Microsoft.Windows.Photos_8wekyb3d8bbwe!App", not a filesystem path. AUMIDs never contain a path
// separator and always end in "!<AppId>"; a real Windows exe path always has at least one backslash. This
// is a heuristic rather than a stored flag specifically to avoid widening the prefs JSON schema and the
// Settings UI's app-picker type just for this one distinction — the shape is distinctive enough not to
// need it.
function isAppUserModelId(value: string): boolean {
  return /![^\\/]+$/.test(value) && !value.includes('\\') && !value.includes('/');
}

/** Launches a local file with a specific app (appPath) or the OS default handler (no appPath) — the
 * macOS `open` command has no Windows equivalent binary, so this branches per platform instead of
 * shelling out to a single cross-platform command. */
export function openLocalFile(filePath: string, appPath: string | undefined, onError: (err: Error) => void): void {
  if (process.platform === 'win32') {
    if (appPath && isAppUserModelId(appPath)) {
      // Store apps have no discrete .exe to spawn — this is the standard CLI-invokable way to activate
      // one. Known limitation: unlike a plain exe spawn, this launches the app itself rather than
      // reliably opening `filePath` inside it — passing a specific file to an arbitrary UWP app's
      // activation from the command line (as opposed to Explorer's own "Open with" flow, which goes
      // through the IApplicationActivationManager COM API) isn't something a plain spawn can guarantee
      // for every app; there's no native binding in scope here to do that properly.
      const child = spawn('explorer', [`shell:AppsFolder\\${appPath}`], { detached: true, stdio: 'ignore' });
      child.on('error', onError);
      child.unref();
      return;
    }
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
