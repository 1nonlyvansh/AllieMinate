import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinFolderPath } from './localFolders';

// The folders a "This Mac"/"This PC" recent-files view scans — same set a user would actually drop new
// files into day to day. Not a full disk crawl: top-level only, per folder, so this stays fast even on a
// Desktop/Downloads folder with thousands of items. Prefers the Electron-resolved real path (correct even
// if a folder was relocated) and only falls back to a guessed os.homedir() join when that's unavailable
// (e.g. a bare `node dist/index.js` dev run with no Electron parent) — the guessed name is 'Videos' on
// Windows, not the macOS-only 'Movies' this used to hardcode unconditionally.
const SCAN_FOLDER_IDS = ['desktop', 'documents', 'downloads', 'pictures', 'videos'] as const;
const FALLBACK_NAMES: Record<(typeof SCAN_FOLDER_IDS)[number], string> = {
  desktop: 'Desktop',
  documents: 'Documents',
  downloads: 'Downloads',
  pictures: 'Pictures',
  videos: process.platform === 'darwin' ? 'Movies' : 'Videos',
};
const SCAN_ROOTS = SCAN_FOLDER_IDS.map((id) => builtinFolderPath(id) ?? path.join(os.homedir(), FALLBACK_NAMES[id]));
const MAX_PER_FOLDER = 200;

export interface LocalRecentFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', pdf: 'application/pdf',
};

export function guessMime(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext];
}

export function listLocalRecentFiles(limit: number): LocalRecentFile[] {
  const entries: LocalRecentFile[] = [];
  for (const root of SCAN_ROOTS) {
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue; // folder doesn't exist (e.g. no Movies folder) — just skip it
    }
    for (const name of names.slice(0, MAX_PER_FOLDER)) {
      if (name.startsWith('.')) continue;
      const full = path.join(root, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        entries.push({ path: full, name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mimeType: guessMime(name) });
      } catch {
        // vanished between readdir and stat, or a permission error — skip it
      }
    }
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
