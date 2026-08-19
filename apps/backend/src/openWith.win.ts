import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OpenWithCategory, BROWSER_ELIGIBLE, OpenWithApp } from './openWith';

// one representative extension per category — enough to enumerate the registered handlers for that file
// kind without needing a fixed install-location list the way the macOS module scans /Applications.
const CATEGORY_SAMPLE_EXT: Record<OpenWithCategory, string> = {
  pdf: 'pdf',
  docx: 'docx',
  spreadsheet: 'xlsx',
  pptx: 'pptx',
  image: 'jpg',
  video: 'mp4',
  audio: 'mp3',
};

function regQueryValue(keyPath: string, valueName: string): string | null {
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', valueName], { encoding: 'utf-8' });
    const line = out.split(/\r?\n/).find((l) => l.trim().startsWith(valueName));
    const match = line?.match(/REG_(?:SZ|EXPAND_SZ)\s+(.*)$/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function regQueryDefaultValue(keyPath: string): string | null {
  try {
    const out = execFileSync('reg', ['query', keyPath, '/ve'], { encoding: 'utf-8' });
    // must accept REG_EXPAND_SZ too, not just REG_SZ — several built-in Windows apps (confirmed live:
    // Windows Media Player's WMP11.AssocFile.MP4) register their shell\open\command as an expandable
    // string containing a literal %ProgramFiles(x86)%-style reference, which silently vanished here
    // before, making an otherwise-real, installed default handler resolve to nothing.
    const line = out.split(/\r?\n/).find((l) => /REG_(?:SZ|EXPAND_SZ)/.test(l));
    const match = line?.match(/REG_(?:SZ|EXPAND_SZ)\s+(.*)$/);
    const value = match ? match[1].trim() : null;
    // reg.exe prints the literal placeholder text "(value not set)" for a key with no default value at
    // all — same REG_SZ line shape as a real one, so it matched the regex above and got treated as real
    // data (a bogus ProgId when read off HKCR\.<ext>, or a bogus display name when read off a ProgId key
    // that only defines shell\open\command with no top-level description of its own — very common, e.g.
    // Windows Media Player's WMP11.AssocFile.MP4).
    return value && value !== '(value not set)' ? value : null;
  } catch {
    return null;
  }
}

// value NAMES (not data) directly under a key — used to enumerate OpenWithProgids/OpenWithList entries,
// the same lists Explorer's own "Open with" dialog draws from.
function regQueryValueNames(keyPath: string): string[] {
  try {
    const out = execFileSync('reg', ['query', keyPath], { encoding: 'utf-8' });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /\sREG_(SZ|NONE|EXPAND_SZ|BINARY)(\s|$)/.test(l))
      .map((l) => l.split(/\s+REG_/)[0].trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// REG_EXPAND_SZ values carry literal %VAR% placeholders the reader is expected to expand — reg.exe
// doesn't do this for us, so a path like "%ProgramFiles(x86)%\Windows Media Player\wmplayer.exe" needs
// this before fs.existsSync means anything. Handle both %VAR% and %VAR\ patterns.
function expandEnvVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
    .replace(/%([^%\\]+)(?=\\)/g, (match, name) => process.env[name] ?? match);
}

function extractExePath(command: string): string | null {
  const quoted = command.match(/^\s*"([^"]+)"/);
  if (quoted) return quoted[1];
  const bare = command.match(/^\s*(\S+\.exe)/i);
  return bare ? bare[1] : null;
}

function commandForProgId(progId: string): { exePath: string; name: string } | null {
  const cmd = regQueryDefaultValue(`HKCR\\${progId}\\shell\\open\\command`);
  if (!cmd) return null;
  const rawExePath = extractExePath(cmd);
  if (!rawExePath) return null;
  const exePath = expandEnvVars(rawExePath);
  if (!fs.existsSync(exePath)) return null;
  // the ProgId key's own default value is sometimes a human-readable type name ("Adobe Acrobat Document")
  // and sometimes a %1-style command-verb string — only trust it as a display name in the former case.
  const friendly = regQueryDefaultValue(`HKCR\\${progId}`);
  const name = friendly && !/%|\.exe$/i.test(friendly) ? friendly : path.basename(exePath, path.extname(exePath));
  return { exePath, name };
}

// A Windows Store (UWP/MSIX) app has no discrete .exe on disk at all — commandForProgId's shell\open\
// command lookup either finds nothing, or finds one guarded by a DelegateExecute verb handler with no
// usable plain exe path. Every packaged app still registers an AppUserModelID under its ProgId's
// Application subkey though (confirmed live: HKCR\<AppXProgId>\Application\AppUserModelID = e.g.
// "Microsoft.Windows.Photos_8wekyb3d8bbwe!App") — that string is what `explorer.exe shell:AppsFolder\
// <AUMID>` (see openLauncher.ts) needs to launch it, so it's returned as the "path" here instead of a
// real file path, with kind:'uwp' telling the launcher which mechanism to use.
function uwpAppForProgId(progId: string): { aumid: string; name: string } | null {
  const aumid = regQueryValue(`HKCR\\${progId}\\Application`, 'AppUserModelID');
  if (!aumid) return null;
  // AUMIDs look like "Publisher.PackageName_hash!App" — the package name segment (before the publisher
  // hash) is the closest thing to a real display name available without resolving an indirect
  // ms-resource:// string, which needs a native API this module has no access to.
  const packageName = aumid.split('!')[0].split('_')[0];
  const name = packageName.replace(/^Microsoft\./, '').replace(/\./g, ' ').trim() || aumid;
  return { aumid, name };
}

function exePathFromAppPaths(exeName: string): string | null {
  const raw =
    regQueryDefaultValue(`HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`) ??
    regQueryDefaultValue(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`);
  if (!raw) return null;
  const resolved = expandEnvVars(raw);
  return fs.existsSync(resolved) ? resolved : null;
}

let cachedDefaultBrowser: { name: string; path: string } | null | undefined;

/** Windows equivalent of the macOS module's LaunchServices lookup — reads the per-user chosen ProgId for
 * the http:// URL association and resolves its registered shell-open command to a real exe path. */
function getDefaultBrowser(): { name: string; path: string } | null {
  if (cachedDefaultBrowser !== undefined) return cachedDefaultBrowser;
  const progId = regQueryValue(
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
    'ProgId',
  );
  if (!progId) return (cachedDefaultBrowser = null);
  const resolved = commandForProgId(progId);
  return (cachedDefaultBrowser = resolved ? { name: resolved.name, path: resolved.exePath } : null);
}

/** Windows has no fixed install-location list like macOS's /Applications — instead this reads the real
 * per-extension file-association data straight from the registry: the user's chosen default handler
 * (FileExts\.<ext>\UserChoice), every ProgId registered as capable of opening it (.<ext>\OpenWithProgids),
 * HKCR\.<ext>'s own default value (what most installers actually set, without ever touching the other
 * two — the reason non-PDF categories returned nothing before this existed), and the legacy exe-name list
 * (.<ext>\OpenWithList, resolved through the App Paths registry) — the same sources Explorer's own "Open
 * with" dialog draws from. Any progId that doesn't resolve to a real exe falls back to a UWP/Store-app
 * check before being dropped. */
export function getAvailableApps(category: OpenWithCategory): OpenWithApp[] {
  const ext = CATEGORY_SAMPLE_EXT[category];
  const progIds = new Set<string>();

  const userChoice = regQueryValue(
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}\\UserChoice`,
    'ProgId',
  );
  if (userChoice) progIds.add(userChoice);
  for (const id of regQueryValueNames(`HKCR\\.${ext}\\OpenWithProgids`)) progIds.add(id);
  const hkcrDefault = regQueryDefaultValue(`HKCR\\.${ext}`);
  if (hkcrDefault) progIds.add(hkcrDefault);

  const apps: OpenWithApp[] = [];
  const seenPaths = new Set<string>();
  for (const progId of progIds) {
    const resolved = commandForProgId(progId);
    if (resolved) {
      if (!seenPaths.has(resolved.exePath)) {
        seenPaths.add(resolved.exePath);
        apps.push({ name: resolved.name, path: resolved.exePath });
      }
      continue;
    }
    const uwp = uwpAppForProgId(progId);
    if (uwp && !seenPaths.has(uwp.aumid)) {
      seenPaths.add(uwp.aumid);
      apps.push({ name: uwp.name, path: uwp.aumid, kind: 'uwp' });
    }
  }

  for (const exeName of regQueryValueNames(`HKCR\\.${ext}\\OpenWithList`)) {
    if (!exeName.toLowerCase().endsWith('.exe')) continue;
    const exePath = exePathFromAppPaths(exeName);
    if (exePath && !seenPaths.has(exePath)) {
      seenPaths.add(exePath);
      apps.push({ name: path.basename(exePath, '.exe'), path: exePath });
    }
  }

  if (BROWSER_ELIGIBLE.includes(category)) {
    const browser = getDefaultBrowser();
    if (browser && !seenPaths.has(browser.path)) apps.push({ name: `Default Browser (${browser.name})`, path: browser.path });
  }

  return apps;
}
