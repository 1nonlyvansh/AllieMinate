import fs from 'node:fs';
import type { FolderConfig } from '@alliminate/shared';
import { dataPath } from '../paths';

const FOLDERS_PATH = dataPath('folders.json');

export function loadFolders(): FolderConfig[] {
  if (!fs.existsSync(FOLDERS_PATH)) return [];
  return JSON.parse(fs.readFileSync(FOLDERS_PATH, 'utf-8'));
}

export function saveFolders(folders: FolderConfig[]): void {
  fs.writeFileSync(FOLDERS_PATH, JSON.stringify(folders, null, 2));
}

/** Every linked Google Drive account should have a whole-account "*" read-only view, not just its
 * "inbox" upload folder — otherwise files the user already has in Drive (outside AllieMinate's own
 * inbox folder) never show up anywhere in the app. Older accounts linked before this existed are
 * missing it; this backfills them idempotently on every boot. */
export function backfillDriveLibraryFolders(folders: FolderConfig[], driveProviderIds: string[]): FolderConfig[] {
  let changed = false;
  for (const providerId of driveProviderIds) {
    if (folders.some((f) => f.provider === providerId && f.remotePrefix === '*')) continue;
    const inboxFolder = folders.find((f) => f.provider === providerId);
    const label = inboxFolder?.name.replace(/\s*\(Drive\)$/, '') ?? providerId;
    folders.push({
      id: `${providerId}-library`,
      name: `${label} (All Files)`,
      localPath: '',
      provider: providerId,
      remotePrefix: '*',
      pinned: false,
    });
    changed = true;
  }
  // whole-account "*" views are browse-everything, not quick-access shortcuts — default them off the
  // Pinned Folders grid (the user can still pin one explicitly). Only touches folders that predate the
  // `pinned` field entirely, so an explicit user choice is never overwritten.
  for (const f of folders) {
    if (f.remotePrefix === '*' && f.pinned === undefined) {
      f.pinned = false;
      changed = true;
    }
  }
  if (changed) saveFolders(folders);
  return folders;
}
