import fs from 'node:fs';
import crypto from 'node:crypto';

// MD5, not something stronger — chosen to match what the providers that DO expose a real content hash
// already use (Google Drive's md5Checksum, S3-compatible ETag on single-part uploads), so a locally
// computed hash can be compared directly against FileEntry.hash with zero extra remote calls. Providers
// that leave FileEntry.hash empty (MEGA, OneDrive, pCloud) just fall back to the size+mtime heuristic —
// this is a sync change-detector, not a security primitive, so MD5's weaknesses don't apply here.
const HASH_SIZE_LIMIT_BYTES = 200 * 1024 * 1024;

/** Streams the file through MD5 rather than reading it whole into memory — returns null for files over the
 * size limit (hashing a multi-GB file on every reconciliation pass costs more than the transfer it might
 * save) so callers fall back to the size+mtime heuristic for those. */
/** Same MD5, but over bytes already in memory (a just-downloaded/just-read buffer) — avoids a second disk
 * read of a file the caller already has open, still respects the same size limit so a huge in-memory
 * buffer doesn't get hashed synchronously on the event loop for no reason. */
export function hashBuffer(data: Buffer): string | null {
  if (data.length > HASH_SIZE_LIMIT_BYTES) return null;
  return crypto.createHash('md5').update(data).digest('hex');
}

export function hashFile(absPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let size: number;
    try {
      size = fs.statSync(absPath).size;
    } catch {
      resolve(null);
      return;
    }
    if (size > HASH_SIZE_LIMIT_BYTES) {
      resolve(null);
      return;
    }
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(absPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}
