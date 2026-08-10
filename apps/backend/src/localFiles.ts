import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { builtinFolderPath } from './localFolders';

// The folders a "This Mac"/"This PC" recent-files view scans — same set a user would actually drop new
// files into day to day, walked recursively (see listLocalRecentFiles below) so a file in any subfolder
// counts too. Prefers the Electron-resolved real path (correct even if a folder was relocated) and only
// falls back to a guessed os.homedir() join when that's unavailable (e.g. a bare `node dist/index.js` dev
// run with no Electron parent) — the guessed name is 'Videos' on Windows, not the macOS-only 'Movies' this
// used to hardcode unconditionally.
const SCAN_FOLDER_IDS = ['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music'] as const;
const FALLBACK_NAMES: Record<(typeof SCAN_FOLDER_IDS)[number], string> = {
  desktop: 'Desktop',
  documents: 'Documents',
  downloads: 'Downloads',
  pictures: 'Pictures',
  videos: process.platform === 'darwin' ? 'Movies' : 'Videos',
  music: 'Music',
};
// Both macOS and Windows default screenshots into a Screenshots subfolder one level under Pictures — one
// level too deep for the top-level-only scan below to ever see. macOS additionally lets a user redirect
// where screenshots save (Screenshot app > Options > Save to), which `defaults read` reports back exactly;
// read it live instead of assuming the default, since a user who customized it is exactly the case a
// hardcoded guess would miss.
function macScreenshotDir(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = execFileSync('defaults', ['read', 'com.apple.screencapture', 'location'], { encoding: 'utf8' }).trim();
    if (!raw) return null;
    return raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
  } catch {
    return null; // key unset — never customized, so screenshots still save straight to Desktop
  }
}

const customMacScreenshotDir = macScreenshotDir();
// Recursion (see listLocalRecentFiles below) means a root nested inside another root would get walked
// twice — once directly, once again as part of its parent's own recursion — and every file under it would
// show up as a duplicate entry. customMacScreenshotDir is exactly this on a default setup (it resolves to
// Pictures/Screenshots, already inside the 'pictures' root), so collapse down to only the outermost roots.
function collapseNestedRoots(candidates: string[]): string[] {
  const unique = Array.from(new Set(candidates));
  return unique.filter((root) => !unique.some((other) => other !== root && root.startsWith(other + path.sep)));
}
const SCAN_ROOTS = collapseNestedRoots([
  ...SCAN_FOLDER_IDS.map((id) => builtinFolderPath(id) ?? path.join(os.homedir(), FALLBACK_NAMES[id])),
  ...(customMacScreenshotDir ? [customMacScreenshotDir] : []),
]);
// Recent Files is a glance-at-your-documents widget, not a general file browser — an allowlist of the
// types worth surfacing there (documents, media, archives), deliberately excluding code/build artifacts
// (.js, .dmg, .lnk, project files, ...) even when those are genuinely the most recently modified thing on
// disk (as on a dev machine mid-build).
const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'jpg', 'jpeg', 'png', 'webp', 'svg', 'ico', 'heic', 'heif',
  'mp4',
  'ppt', 'pptx',
  'doc', 'docx',
  'mp3', 'm4a', 'wav',
  'zip', 'rar',
]);
// Directories that are technically folders on disk but never worth descending into for this widget — either
// opaque OS/app packages (Photos' own multi-gigabyte internal library, installed .app bundles) that could
// never contain a file matching ALLOWED_EXTENSIONS above anyway, or plain dev-tooling directories.
const OPAQUE_SKIP_EXTENSIONS = new Set([
  'app', 'photoslibrary', 'musiclibrary', 'tvlibrary', 'theater', 'bundle',
  'framework', 'plugin', 'kext', 'prefpane', 'qlgenerator', 'component', 'saver',
]);
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);
const MAX_DEPTH = 8;
// Hard safety valve, not a per-folder quota — recursion means one huge subtree (a cloned repo dropped in
// Downloads, a giant project folder) can no longer starve every other root of its share, so this caps the
// walk as a whole instead.
const MAX_TOTAL_ENTRIES = 20000;
// This runs synchronously-in-spirit (see the setImmediate yields in walk() below) but is now polled every
// 15s by the tray panel (TrayPanel.tsx) — a walk with no time limit could pile up on a big enough disk.
// Wall-clock, not a stat-call counter, so it accounts for the yields too.
const WALK_TIME_BUDGET_MS = 4000;

export interface LocalRecentFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  zip: 'application/zip', rar: 'application/vnd.rar',
};

export function guessMime(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext];
}

// Yields the event loop periodically during a deep walk — this backend does a lot else besides serve this
// one route (sync engine ticks, other API requests), and a multi-thousand-file recursive scan running
// fully synchronously would stall all of it for however long the walk takes, every 15s, for as long as the
// tray stays open.
const YIELD_EVERY_N_ENTRIES = 200;

async function walk(root: string, deadline: number, budget: { count: number }, depth: number): Promise<LocalRecentFile[]> {
  if (depth > MAX_DEPTH || budget.count >= MAX_TOTAL_ENTRIES || Date.now() > deadline) return [];
  let names: string[];
  try {
    names = await fs.promises.readdir(root);
  } catch {
    return []; // folder doesn't exist (e.g. no Movies folder), or a permission error — skip it
  }

  const out: LocalRecentFile[] = [];
  for (const name of names) {
    if (budget.count >= MAX_TOTAL_ENTRIES || Date.now() > deadline) break;
    if (name.startsWith('.') || SKIP_DIR_NAMES.has(name)) continue;

    const full = path.join(root, name);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(full);
    } catch {
      continue; // vanished between readdir and stat, or a permission error
    }

    const ext = name.split('.').pop()?.toLowerCase();

    if (stat.isDirectory()) {
      if (ext && OPAQUE_SKIP_EXTENSIONS.has(ext)) continue;
      out.push(...(await walk(full, deadline, budget, depth + 1)));
      continue;
    }

    if (!stat.isFile()) continue;
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) continue;
    out.push({ path: full, name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mimeType: guessMime(name) });
    budget.count++;
    if (budget.count % YIELD_EVERY_N_ENTRIES === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return out;
}

export async function listLocalRecentFiles(limit: number): Promise<LocalRecentFile[]> {
  const deadline = Date.now() + WALK_TIME_BUDGET_MS;
  const budget = { count: 0 };
  const entries: LocalRecentFile[] = [];
  for (const root of SCAN_ROOTS) {
    entries.push(...(await walk(root, deadline, budget, 0)));
  }
  entries.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  return entries.slice(0, limit);
}

/** Every route that touches a raw local path (the recent-files download/thumbnail proxy, and the
 * send-to-device/nearby routes when sharing a local Mac file) validates through here first — without
 * this, a crafted `path` query param could read any file the app process has permission to, not just
 * something actually surfaced by the recent-files scan. */
export function isAllowedLocalPath(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  return SCAN_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

// A poll interval, however short, is never actually "real time" — a screenshot or a delete should show up
// in the tray the moment it happens, not up to 15s later. fs.watch's recursive mode (supported on both
// macOS via FSEvents and Windows, which is all this app targets) does that natively instead: one live
// watcher per scan root, debounced so a single save/delete (which fires several raw fs events in quick
// succession) collapses into one notification rather than a burst of them.
const WATCH_DEBOUNCE_MS = 300;

export function startLocalRecentWatcher(onChange: () => void): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleNotify(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
  }

  for (const root of SCAN_ROOTS) {
    try {
      fs.watch(root, { recursive: true }, () => scheduleNotify());
    } catch (err) {
      // a root that vanished after startup, or a platform/filesystem that doesn't support recursive
      // watching (e.g. a network share) — the 15s poll in TrayPanel.tsx is still there as a fallback for
      // exactly this case, so this is a degradation, not a hard failure.
      console.error(`local recent-files watcher failed to start for ${root}:`, err instanceof Error ? err.message : err);
    }
  }
}
