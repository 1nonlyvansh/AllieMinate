import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { dataPath } from './paths';

const PREFS_PATH = dataPath('open-with.json');

export type OpenWithCategory = 'pdf' | 'docx' | 'spreadsheet' | 'pptx' | 'image' | 'video' | 'audio';

interface CandidateApp {
  name: string;
  paths: string[];
}

const CANDIDATE_APPS: Record<OpenWithCategory, CandidateApp[]> = {
  pdf: [
    { name: 'Preview', paths: ['/System/Applications/Preview.app', '/Applications/Preview.app'] },
    { name: 'Google Chrome', paths: ['/Applications/Google Chrome.app'] },
    { name: 'Adobe Acrobat Reader DC', paths: ['/Applications/Adobe Acrobat Reader DC.app'] },
  ],
  docx: [
    { name: 'Microsoft Word', paths: ['/Applications/Microsoft Word.app'] },
    { name: 'Pages', paths: ['/Applications/Pages.app', '/System/Applications/Pages.app'] },
    { name: 'TextEdit', paths: ['/System/Applications/TextEdit.app', '/Applications/TextEdit.app'] },
  ],
  spreadsheet: [
    { name: 'Microsoft Excel', paths: ['/Applications/Microsoft Excel.app'] },
    { name: 'Numbers', paths: ['/Applications/Numbers.app', '/System/Applications/Numbers.app'] },
  ],
  pptx: [
    { name: 'Microsoft PowerPoint', paths: ['/Applications/Microsoft PowerPoint.app'] },
    { name: 'Keynote', paths: ['/Applications/Keynote.app', '/System/Applications/Keynote.app'] },
  ],
  image: [
    { name: 'Preview', paths: ['/System/Applications/Preview.app', '/Applications/Preview.app'] },
    { name: 'Google Chrome', paths: ['/Applications/Google Chrome.app'] },
  ],
  video: [
    { name: 'QuickTime Player', paths: ['/System/Applications/QuickTime Player.app', '/Applications/QuickTime Player.app'] },
    { name: 'VLC', paths: ['/Applications/VLC.app'] },
    { name: 'IINA', paths: ['/Applications/IINA.app'] },
  ],
  audio: [
    { name: 'Music', paths: ['/System/Applications/Music.app'] },
    { name: 'QuickTime Player', paths: ['/System/Applications/QuickTime Player.app', '/Applications/QuickTime Player.app'] },
    { name: 'VLC', paths: ['/Applications/VLC.app'] },
  ],
};

const EXT_TO_CATEGORY: Record<string, OpenWithCategory> = {
  pdf: 'pdf',
  doc: 'docx',
  docx: 'docx',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  csv: 'spreadsheet',
  ppt: 'pptx',
  pptx: 'pptx',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  heif: 'image',
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  webm: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  aac: 'audio',
  flac: 'audio',
  m4a: 'audio',
  ogg: 'audio',
};

// native cloud files (and some phone-recorded videos) can genuinely have no file extension at all in
// their stored name — "open" with no extension falls back unpredictably on macOS (often TextEdit, which
// then shows a video/binary file's raw bytes as garbled text). MIME type from the provider is the
// fallback source of truth when the name itself has nothing to go on.
const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
};

export function extFromMime(mimeType: string): string | null {
  return MIME_TO_EXT[mimeType] ?? null;
}

export function categoryForFile(name: string, mimeType?: string): OpenWithCategory | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (EXT_TO_CATEGORY[ext]) return EXT_TO_CATEGORY[ext];
  const mimeExt = mimeType ? extFromMime(mimeType) : null;
  return mimeExt ? EXT_TO_CATEGORY[mimeExt] ?? null : null;
}

// categories where "open with the browser" is a genuinely useful option (pdf viewable inline, images
// viewable inline) — office formats need a real editor, a browser tab won't render them.
const BROWSER_ELIGIBLE: OpenWithCategory[] = ['pdf', 'image'];

let cachedDefaultBrowser: { name: string; path: string } | null | undefined;

const APP_SCAN_DIRS = ['/Applications', '/System/Applications', `${process.env.HOME}/Applications`];

/** Resolves the user's actual system default browser (not a hardcoded guess) via LaunchServices' handler
 * for the http:// scheme, then finds that bundle's .app path by scanning the usual app directories and
 * reading each one's real CFBundleIdentifier. Deliberately not mdfind/Spotlight — LaunchServices stores
 * bundle ids lowercased in its plist (e.g. "com.google.chrome.beta") while the app's real Info.plist can
 * use different casing ("com.google.Chrome.beta"), and mdfind's CFBundleIdentifier match is case-sensitive
 * with no working case-insensitive fallback, so it silently finds nothing for exactly this kind of app. */
function getDefaultBrowser(): { name: string; path: string } | null {
  if (cachedDefaultBrowser !== undefined) return cachedDefaultBrowser;
  try {
    const plistPath = `${process.env.HOME}/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist`;
    if (!fs.existsSync(plistPath)) return (cachedDefaultBrowser = null);

    const json = execSync(`plutil -convert json -o - "${plistPath}"`, { encoding: 'utf-8' });
    const data = JSON.parse(json);
    const handler = (data.LSHandlers ?? []).find((h: any) => h.LSHandlerURLScheme === 'http');
    const bundleId: string | undefined = handler?.LSHandlerRoleAll ?? handler?.LSHandlerRoleViewer;
    if (!bundleId) return (cachedDefaultBrowser = null);
    const target = bundleId.toLowerCase();

    for (const dir of APP_SCAN_DIRS) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.app')) continue;
        const appPath = `${dir}/${entry}`;
        try {
          const id = execSync(`plutil -extract CFBundleIdentifier raw -o - "${appPath}/Contents/Info.plist"`, { encoding: 'utf-8' }).trim();
          if (id.toLowerCase() === target) {
            return (cachedDefaultBrowser = { name: entry.replace(/\.app$/, ''), path: appPath });
          }
        } catch {
          // not every .app has a readable Info.plist (e.g. broken bundles) — skip and keep scanning
        }
      }
    }
    return (cachedDefaultBrowser = null);
  } catch {
    return (cachedDefaultBrowser = null);
  }
}

/** Only the apps actually installed on this Mac, for the given category — plus the real system default
 * browser when that's a sensible way to open this category (pdf/image). */
export function getAvailableApps(category: OpenWithCategory): { name: string; path: string }[] {
  const installed = CANDIDATE_APPS[category]
    .map((candidate) => ({ name: candidate.name, path: candidate.paths.find((p) => fs.existsSync(p)) }))
    .filter((a): a is { name: string; path: string } => !!a.path);

  if (!BROWSER_ELIGIBLE.includes(category)) return installed;

  const browser = getDefaultBrowser();
  if (!browser || installed.some((a) => a.path === browser.path)) return installed;
  return [...installed, { name: `Default Browser (${browser.name})`, path: browser.path }];
}

export function loadOpenWithPrefs(): Partial<Record<OpenWithCategory, string>> {
  if (!fs.existsSync(PREFS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveOpenWithPref(category: OpenWithCategory, appPath: string | null): void {
  const prefs = loadOpenWithPrefs();
  if (appPath) prefs[category] = appPath;
  else delete prefs[category];
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}
