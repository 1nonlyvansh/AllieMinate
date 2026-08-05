import fs from 'node:fs';
import { dataPath } from './paths';

const TRASH_PATH = dataPath('trash.json');

export interface TrashEntry {
  id: string;
  name: string;
  size: number;
  provider: string;
  originalFolderId: string;
  originalKey: string;
  trashKey: string;
  deletedAt: string;
}

export function loadTrash(): TrashEntry[] {
  if (!fs.existsSync(TRASH_PATH)) return [];
  return JSON.parse(fs.readFileSync(TRASH_PATH, 'utf-8'));
}

// /files/trash "deletes" a file by renaming it to "_trash/<uuid>__<original name>" and leaving it right
// there in the same managed storage (no real trash primitive to move it to on most providers) — a real
// pinned folder's list(prefix) never matches that name so it's naturally invisible there, but any
// WHOLE-ACCOUNT listing (listAll, or a raw folder browse) has no such filter and surfaces it as a
// UUID-named ghost file. Every whole-account read (including /search, which does its own listAll() fan-
// out) needs this — a query for the original filename would otherwise resurface the trashed copy too.
export function withoutTrash<T extends { path: string }>(files: T[]): T[] {
  return files.filter((f) => !f.path.startsWith('_trash/'));
}

export function saveTrash(entries: TrashEntry[]): void {
  fs.writeFileSync(TRASH_PATH, JSON.stringify(entries, null, 2));
}
