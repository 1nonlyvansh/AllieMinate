import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { OpenWithCategory, BROWSER_ELIGIBLE } from './openWith';

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
