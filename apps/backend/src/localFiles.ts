import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinFolderPath } from './localFolders';

// The folders a "This Mac"/"This PC" recent-files view scans — same set a user would actually drop new
// files into day to day. Prefers the Electron-resolved real path (correct even if a folder was relocated)
// and only falls back to a guessed os.homedir() join when that's unavailable (e.g. a bare `node
// dist/index.js` dev run with no Electron parent) — the guessed name is 'Videos' on Windows, not the
// macOS-only 'Movies' this used to hardcode unconditionally.
const SCAN_FOLDER_IDS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const;
const FALLBACK_NAMES: Record<(typeof SCAN_FOLDER_IDS)[number], string> = {
  desktop: 'Desktop',
  documents: 'Documents',
  downloads: 'Downloads',
  pictures: 'Pictures',
  music: 'Music',
  videos: process.platform === 'darwin' ? 'Movies' : 'Videos',
};
const SCAN_ROOTS = SCAN_FOLDER_IDS.map((id) => builtinFolderPath(id) ?? path.join(os.homedir(), FALLBACK_NAMES[id]));

export interface LocalRecentFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  zip: 'application/zip', rar: 'application/vnd.rar',
};

// Allowlist, not denylist — anything not explicitly listed here is excluded by construction. Keeps this
// view to files a user would actually recognize as "something I made or received" (documents, media,
// archives), never code/build/shortcut noise (.lnk, .url, .js, .exe, desktop.ini, ...) regardless of how
// recently it was touched.
export function guessMime(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext];
}

function isAllowedExt(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext in EXT_MIME;
}

const MAX_DEPTH = 8;
const MAX_FILES_VISITED = 20_000;
const WALK_TIME_BUDGET_MS = 4000;
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);

interface WalkBudget {
  visited: number;
  deadline: number;
}

function walkDir(root: string, depth: number, budget: WalkBudget, out: LocalRecentFile[]): void {
  if (depth > MAX_DEPTH || budget.visited >= MAX_FILES_VISITED || Date.now() > budget.deadline) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return; // folder doesn't exist, or a permission error — skip it
  }

  for (const entry of entries) {
    if (budget.visited >= MAX_FILES_VISITED || Date.now() > budget.deadline) return;
    if (entry.name.startsWith('.')) continue; // dotfiles/dot-folders at any depth

    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (path.extname(entry.name)) continue; // opaque bundle-style folder (e.g. a stray .app) — skip, not a real content dir
      walkDir(full, depth + 1, budget, out);
      continue;
    }

    if (!entry.isFile()) continue;
    budget.visited += 1;
    if (!isAllowedExt(entry.name)) continue;

    try {
      const stat = fs.statSync(full);
      out.push({ path: full, name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mimeType: guessMime(entry.name) });
    } catch {
      // vanished between readdir and stat — skip it
    }
  }
}

export function listLocalRecentFiles(limit: number): LocalRecentFile[] {
  const budget: WalkBudget = { visited: 0, deadline: Date.now() + WALK_TIME_BUDGET_MS };
  const entries: LocalRecentFile[] = [];
  for (const root of SCAN_ROOTS) {
    if (Date.now() > budget.deadline) break;
    walkDir(root, 0, budget, entries);
  }
  entries.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  return entries.slice(0, limit);
}

const WATCH_DEBOUNCE_MS = 300;

/** Real-time push for the "This Mac"/"This PC" recent-files strip — a native filesystem watcher on each
 * scan root instead of relying purely on the tray's poll interval, so a new screenshot or a deleted file
 * shows up the instant it happens. `recursive: true` works natively on both macOS (FSEvents) and Windows,
 * so this needs no per-platform branching. The debounce matters: a single save/screenshot fires several raw
 * fs events in quick succession — without it callers would get a burst of notifications instead of one. */
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
      // a root that vanished, or a filesystem that doesn't support recursive watching (a network share) —
      // the poll loop in TrayPanel.tsx is still there as a fallback for exactly this case.
      console.error(`local recent-files watcher failed to start for ${root}:`, err instanceof Error ? err.message : err);
    }
  }
}

/** Every route that touches a raw local path (the recent-files download/thumbnail proxy, and the
 * send-to-device/nearby routes when sharing a local Mac file) validates through here first — without
 * this, a crafted `path` query param could read any file the app process has permission to, not just
 * something actually surfaced by the recent-files scan. */
export function isAllowedLocalPath(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  // Normalize path separators for cross-platform comparison (Windows paths from URLs use forward slashes)
  const normalizedResolved = resolved.replace(/\\/g, '/');
  return SCAN_ROOTS.some((root) => {
    const normalizedRoot = root.replace(/\\/g, '/');
    return normalizedResolved === normalizedRoot || normalizedResolved.startsWith(normalizedRoot + '/');
  });
}
