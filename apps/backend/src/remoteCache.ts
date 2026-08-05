import fs from 'node:fs';
import { dataPath } from './paths';
import type { StorageBackend } from './storage/StorageBackend';

const INDEX_PATH = dataPath('remote-cache-index.json');

export interface RemoteCacheEntry {
  targetAccountId: string;
  tempKey: string;
  uploadedAt: number;
}

export function loadRemoteCacheIndex(): RemoteCacheEntry[] {
  if (!fs.existsSync(INDEX_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveRemoteCacheIndex(entries: RemoteCacheEntry[]): void {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2));
}

export function addRemoteCacheEntry(entry: RemoteCacheEntry): void {
  const entries = loadRemoteCacheIndex();
  entries.push(entry);
  saveRemoteCacheIndex(entries);
}

export function tempFileName(originalName: string): string {
  return `__tempopen__${Date.now()}__${originalName}`;
}

/** Deletes every temp copy uploaded for cross-cloud online-editor opens — run once at startup so they
 * never sit around visibly eating into the user's real Drive/OneDrive quota. */
export async function cleanupRemoteCache(backends: Map<string, StorageBackend>): Promise<void> {
  const entries = loadRemoteCacheIndex();
  if (entries.length === 0) return;

  for (const entry of entries) {
    const backend = backends.get(entry.targetAccountId);
    if (!backend) continue;
    try {
      await backend.delete(entry.tempKey);
    } catch {
      // best-effort — a manual accounts cleanup or the account being unlinked is fine to skip
    }
  }
  saveRemoteCacheIndex([]);
}
