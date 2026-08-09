import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../paths';

// Per-folder baseline for two-way sync — the "last known good" state of each file on both sides, used to
// tell apart three cases when reconciliation runs: only local changed (push), only remote changed (pull),
// or both changed since the baseline (real conflict — see twoWaySync.ts). Without a stored baseline,
// "local differs from remote" is ambiguous — it could mean either side just made the change.
export interface FileSyncRecord {
  localSize?: number;
  localModifiedAt?: string;
  remoteSize?: number;
  remoteModifiedAt?: string;
  /** MD5 of local content, when known — skipped for files over the hashFile() size threshold. Lets a
   * mtime-only touch (editor re-save with no content change) be recognized as a no-op instead of a
   * re-transfer, and lets a moved/renamed file be matched to its old record instead of treated as a fresh
   * delete+create. */
  localHash?: string;
  /** copied from FileEntry.hash on the remote side — only meaningful for providers that actually populate
   * it (Google Drive's md5Checksum, S3-compatible ETag); empty/absent for MEGA, OneDrive, pCloud. */
  remoteHash?: string;
  /** ISO timestamp of the last reconciliation pass that considered this file confirmed in sync — absent
   * for a record that only holds retry bookkeeping for a file that has never yet synced successfully. */
  lastSyncedAt?: string;
  /** live progress state, surfaced to the Sync Engine UI — 'synced' is the steady state once lastSyncedAt
   * is set; the others only appear transiently or while a retry is pending. */
  status?: 'queued' | 'syncing' | 'synced' | 'error' | 'waiting-network';
  /** exponential-backoff retry bookkeeping — set when the last attempt for this path failed. */
  retryCount?: number;
  nextRetryAt?: string;
  lastError?: string;
  /** Which device actually put this file here, for the Details action's "added by" field — populated
   * whenever THIS device pushes a genuinely new (not just modified) local file (see syncFolderEvent()),
   * and backfilled for files this device only ever PULLED down by reading the manifest.ts sidecar (a
   * device downloading a file from the cloud has no way to know who originally authored it otherwise). */
  addedByDeviceId?: string;
  addedByDeviceName?: string;
  addedAt?: string;
}

export type FolderSyncState = Record<string, FileSyncRecord>; // keyed by path relative to the folder root

function statePath(folderId: string): string {
  return dataPath(`syncState/${folderId}.json`);
}

export function loadSyncState(folderId: string): FolderSyncState {
  const p = statePath(folderId);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveSyncState(folderId: string, state: FolderSyncState): void {
  const p = statePath(folderId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

export function deleteSyncState(folderId: string): void {
  const p = statePath(folderId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
