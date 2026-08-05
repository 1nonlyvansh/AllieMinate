import fs from 'node:fs/promises';
import type { FileEntry, FolderConfig } from '@alliminate/shared';
import { PROVIDER_QUOTA_BYTES, baseProviderOf } from '@alliminate/shared';
import type { SyncTarget } from './syncTarget';
import type { StorageBackend } from '../storage/StorageBackend';

// Best-effort, provider-documented single-file caps — not enforced server-side by this app, just checked
// here so a doomed upload gets a clear "this file is too big for X" error instead of a raw SDK exception,
// and so the transfer attempt isn't wasted at all. B2/iDrive e2 go through a single (non-multipart)
// PutObjectCommand (see S3CompatibleBackend.put) — S3-compatible single PUTs hard-cap at 5GB regardless of
// account tier, that's an API limit, not a guess. The rest are provider-documented ceilings, generous
// enough that they're really just a backstop against something clearly wrong (a multi-terabyte file) —
// exact figures vary by account tier and change over time, treat these as approximate.
const MAX_FILE_SIZE_BYTES: Record<string, number> = {
  b2: 5 * 1024 ** 3,
  'idrive-e2': 5 * 1024 ** 3,
  'google-drive': 5 * 1024 ** 4,
  onedrive: 250 * 1024 ** 3,
  pcloud: 5 * 1024 ** 3,
  mega: 5 * 1024 ** 4,
};

export function maxFileSizeFor(providerId: string): number {
  return MAX_FILE_SIZE_BYTES[baseProviderOf(providerId)] ?? 5 * 1024 ** 3;
}

/** Real usage when the provider exposes it (Drive/OneDrive); otherwise a rough proxy from what this pass
 * already fetched via target.list() plus the shared quota table — approximate, but good enough for a
 * warning gate, not a hard guarantee. */
export async function estimateQuota(folder: FolderConfig, target: SyncTarget, remoteEntries: FileEntry[]): Promise<{ usedBytes: number; totalBytes: number } | null> {
  const backend = target as Partial<StorageBackend>;
  if (backend.getAccountUsage) {
    try {
      const real = await backend.getAccountUsage();
      if (real) return real;
    } catch {
      // fall through to the estimate below rather than skipping the check entirely
    }
  }
  const totalBytes = PROVIDER_QUOTA_BYTES[baseProviderOf(folder.provider) as keyof typeof PROVIDER_QUOTA_BYTES];
  if (!totalBytes) return null;
  const usedBytes = remoteEntries.reduce((sum, e) => sum + e.size, 0);
  return { usedBytes, totalBytes };
}

/** Free space on the volume containing `localPath` — Node's fs.promises.statfs (18.15+). */
export async function freeDiskSpace(localPath: string): Promise<number | null> {
  try {
    const stat = await fs.statfs(localPath);
    return stat.bavail * stat.bsize;
  } catch {
    return null; // statfs unsupported/failed — don't block sync over a check that couldn't run
  }
}
