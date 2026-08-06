import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OpenWithCategory, BROWSER_ELIGIBLE } from './openWith';

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
    const line = out.split(/\r?\n/).find((l) => /REG_SZ/.test(l));
    const match = line?.match(/REG_SZ\s+(.*)$/);
    return match ? match[1].trim() : null;
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

function extractExePath(command: string): string | null {
  const quoted = command.match(/^\s*"([^"]+)"/);
  if (quoted) return quoted[1];
  const bare = command.match(/^\s*(\S+\.exe)/i);
  return bare ? bare[1] : null;
}

function commandForProgId(progId: string): { exePath: string; name: string } | null {
  const cmd = regQueryDefaultValue(`HKCR\\${progId}\\shell\\open\\command`);
  if (!cmd) return null;
  const exePath = extractExePath(cmd);
  if (!exePath || !fs.existsSync(exePath)) return null;
  // the ProgId key's own default value is sometimes a human-readable type name ("Adobe Acrobat Document")
  // and sometimes a %1-style command-verb string — only trust it as a display name in the former case.
  const friendly = regQueryDefaultValue(`HKCR\\${progId}`);
  const name = friendly && !/%|\.exe$/i.test(friendly) ? friendly : path.basename(exePath, path.extname(exePath));
  return { exePath, name };
}

function exePathFromAppPaths(exeName: string): string | null {
  const resolved =
    regQueryDefaultValue(`HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`) ??
    regQueryDefaultValue(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`);
  return resolved && fs.existsSync(resolved) ? resolved : null;
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
 * and the legacy exe-name list (.<ext>\OpenWithList, resolved through the App Paths registry) — the same
 * sources Explorer's own "Open with" dialog draws from. */
export function getAvailableApps(category: OpenWithCategory): { name: string; path: string }[] {
  const ext = CATEGORY_SAMPLE_EXT[category];
  const progIds = new Set<string>();

  const userChoice = regQueryValue(
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}\\UserChoice`,
    'ProgId',
  );
  if (userChoice) progIds.add(userChoice);
  for (const id of regQueryValueNames(`HKCR\\.${ext}\\OpenWithProgids`)) progIds.add(id);

  const apps: { name: string; path: string }[] = [];
  const seenPaths = new Set<string>();
  for (const progId of progIds) {
    const resolved = commandForProgId(progId);
    if (resolved && !seenPaths.has(resolved.exePath)) {
      seenPaths.add(resolved.exePath);
      apps.push({ name: resolved.name, path: resolved.exePath });
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
