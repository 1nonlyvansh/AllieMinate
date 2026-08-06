import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataPath } from './paths';
import { loadReceivePath } from './receiveSettings';

export interface LocalFolderDef {
  id: string;
  name: string;
  path: string;
  builtin: boolean;
}

const SHORTCUTS_PATH = dataPath('local-folder-shortcuts.json');

interface CustomShortcut {
  id: string;
  name: string;
  path: string;
}

function loadCustomShortcuts(): CustomShortcut[] {
  if (!fs.existsSync(SHORTCUTS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHORTCUTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveCustomShortcuts(entries: CustomShortcut[]): void {
  fs.writeFileSync(SHORTCUTS_PATH, JSON.stringify(entries, null, 2));
}

// Resolved once at backend boot from env vars the Electron main process sets when it spawns this process
// (see apps/desktop/src/main/index.ts's spawnBackend) — the backend runs as a plain Node child process
// with no Electron runtime, so it can't call app.getPath() itself. Routing the resolution through
// Electron's main process (rather than guessing a hardcoded per-OS path here) is what makes this correct
// even when a user has relocated a folder via the Windows registry or macOS's own folder settings.
const BUILTIN_DEFS: { id: string; name: string; envKey: string }[] = [
  { id: 'desktop', name: 'Desktop', envKey: 'ALLIMINATE_FOLDER_DESKTOP' },
  { id: 'downloads', name: 'Downloads', envKey: 'ALLIMINATE_FOLDER_DOWNLOADS' },
  { id: 'documents', name: 'Documents', envKey: 'ALLIMINATE_FOLDER_DOCUMENTS' },
  { id: 'pictures', name: 'Pictures', envKey: 'ALLIMINATE_FOLDER_PICTURES' },
  { id: 'videos', name: 'Videos', envKey: 'ALLIMINATE_FOLDER_VIDEOS' },
  { id: 'music', name: 'Music', envKey: 'ALLIMINATE_FOLDER_MUSIC' },
];

/** Real path for a built-in known folder, or null if the env var wasn't set (not running under
 * Electron — e.g. a bare `node dist/index.js` dev invocation) or the folder doesn't actually exist. */
export function builtinFolderPath(id: string): string | null {
  const def = BUILTIN_DEFS.find((d) => d.id === id);
  if (!def) return null;
  const p = process.env[def.envKey];
  return p && fs.existsSync(p) ? p : null;
}

function deviceLabel(): string {
  if (process.platform === 'darwin') return 'Mac';
  if (process.platform === 'win32') return 'PC';
  return 'Device';
}

/** Every local folder this device currently exposes to a browsing peer (or to its own UI) — the
 * "Received" inbox first (mirrors Android's LocalHttpServer ordering), then whichever built-in known
 * folders actually resolved, then user-added custom shortcuts. Filters out anything that no longer
 * exists on disk rather than erroring — a relocated/deleted folder just quietly drops off the list. */
export function listLocalFolders(): LocalFolderDef[] {
  const out: LocalFolderDef[] = [];
  const receivePath = loadReceivePath();
  if (fs.existsSync(receivePath)) out.push({ id: 'received', name: `Received on ${deviceLabel()}`, path: receivePath, builtin: true });

  for (const def of BUILTIN_DEFS) {
    const p = builtinFolderPath(def.id);
    if (p) out.push({ id: def.id, name: def.name, path: p, builtin: true });
  }

  for (const c of loadCustomShortcuts()) {
    if (fs.existsSync(c.path)) out.push({ id: c.id, name: c.name, path: c.path, builtin: false });
  }

  return out;
}

export function findLocalFolder(id: string): LocalFolderDef | null {
  return listLocalFolders().find((f) => f.id === id) ?? null;
}

export function addCustomFolder(name: string, folderPath: string): LocalFolderDef {
  const resolved = path.resolve(folderPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('not a real folder on this device');
  }
  const entries = loadCustomShortcuts();
  const entry: CustomShortcut = { id: crypto.randomUUID(), name: name.trim() || path.basename(resolved), path: resolved };
  entries.push(entry);
  saveCustomShortcuts(entries);
  return { ...entry, builtin: false };
}

export function removeCustomFolder(id: string): void {
  saveCustomShortcuts(loadCustomShortcuts().filter((e) => e.id !== id));
}

/** Every route that touches a raw local path inside a local-folder browse validates through here first
 * — containment must be inside one of the CURRENTLY listed folders (built-in or custom), the same
 * protection isAllowedLocalPath already gives the older fixed-SCAN_ROOTS recent-files feature, just
 * scoped to whatever this device is actually exposing right now instead of a fixed list. */
export function isAllowedLocalFolderPath(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  return listLocalFolders().some((f) => {
    const root = path.resolve(f.path);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}
