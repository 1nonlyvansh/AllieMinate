import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../paths';

const LIMIT_PATH = dataPath('bandwidthLimit.json');

/** bytes/sec, or null for unlimited. */
export function loadBandwidthLimit(): number | null {
  if (!fs.existsSync(LIMIT_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(LIMIT_PATH, 'utf-8'));
    return typeof parsed.bytesPerSec === 'number' && parsed.bytesPerSec > 0 ? parsed.bytesPerSec : null;
  } catch {
    return null;
  }
}

export function saveBandwidthLimit(bytesPerSec: number | null): void {
  fs.mkdirSync(path.dirname(LIMIT_PATH), { recursive: true });
  fs.writeFileSync(LIMIT_PATH, JSON.stringify({ bytesPerSec }, null, 2));
}

// A simple token bucket, not true streaming rate-limiting — every transfer in this app reads a whole file
// into memory and does one put()/get() call rather than a chunked stream, so there's no per-chunk hook to
// throttle against. This instead delays the CALL by however long it would have taken to move that many
// bytes at the configured rate, which caps sustained average throughput across many files even though any
// single large file's own transfer still happens at full network speed. Good enough to keep Auto-Sync from
// saturating the connection during a big batch; not a precise per-second cap on an individual transfer.
let bucket = 0;
let lastRefill = Date.now();

export async function throttle(bytes: number): Promise<void> {
  const limit = loadBandwidthLimit();
  if (!limit) return;

  const now = Date.now();
  const elapsedSec = (now - lastRefill) / 1000;
  bucket = Math.min(limit, bucket + elapsedSec * limit); // cap burst allowance at 1 second worth
  lastRefill = now;

  if (bucket >= bytes) {
    bucket -= bytes;
    return;
  }
  const deficit = bytes - bucket;
  const waitMs = (deficit / limit) * 1000;
  bucket = 0;
  lastRefill = Date.now() + waitMs;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
