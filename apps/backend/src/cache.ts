import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './paths';

const CACHE_DIR = dataPath('cache');
const INDEX_PATH = path.join(CACHE_DIR, 'index.json');
const SETTINGS_PATH = dataPath('cache-settings.json');
const DEFAULT_MAX_BYTES = 5 * 1024 ** 3;
const MIN_MAX_BYTES = 1 * 1024 ** 3;
const MAX_MAX_BYTES = 5 * 1024 ** 3;

interface CacheEntry {
  fileName: string;
  providerKey: string;
  sourceKey: string;
  size: number;
  lastAccessed: number;
}

function ensureDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadIndex(): CacheEntry[] {
  ensureDir();
  if (!fs.existsSync(INDEX_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveIndex(entries: CacheEntry[]): void {
  ensureDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2));
}

export function loadCacheSettings(): { maxBytes: number } {
  if (!fs.existsSync(SETTINGS_PATH)) return { maxBytes: DEFAULT_MAX_BYTES };
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return { maxBytes: parsed.maxBytes ?? DEFAULT_MAX_BYTES };
  } catch {
    return { maxBytes: DEFAULT_MAX_BYTES };
  }
}

export function saveCacheSettings(maxBytes: number): void {
  const clamped = Math.min(MAX_MAX_BYTES, Math.max(MIN_MAX_BYTES, maxBytes));
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ maxBytes: clamped }, null, 2));
  enforceLimit();
}

function entryPath(entry: CacheEntry): string {
  return path.join(CACHE_DIR, entry.fileName);
}

function cacheKey(providerKey: string, sourceKey: string): string {
  return `${providerKey}::${sourceKey}`;
}

/** Evicts least-recently-accessed entries until usage is back under the configured limit. */
function enforceLimit(): void {
  const { maxBytes } = loadCacheSettings();
  const entries = loadIndex().sort((a, b) => a.lastAccessed - b.lastAccessed);
  let total = entries.reduce((sum, e) => sum + e.size, 0);

  const kept: CacheEntry[] = [];
  for (const entry of entries) {
    if (total <= maxBytes) {
      kept.push(entry);
      continue;
    }
    try {
      fs.unlinkSync(entryPath(entry));
      fs.rmdirSync(path.dirname(entryPath(entry))); // tidy up the now-empty per-key subdirectory
    } catch {
      // already gone, or the dir wasn't empty (shouldn't happen — one file per key dir) — fine either way
    }
    total -= entry.size;
  }
  saveIndex(kept.sort((a, b) => b.lastAccessed - a.lastAccessed));
}

/** Returns the cached file's absolute path if present, bumping its last-accessed time. */
export function getCachedPath(providerKey: string, sourceKey: string): string | null {
  const entries = loadIndex();
  const key = cacheKey(providerKey, sourceKey);
  const entry = entries.find((e) => cacheKey(e.providerKey, e.sourceKey) === key);
  if (!entry) return null;

  const filePath = entryPath(entry);
  if (!fs.existsSync(filePath)) return null;

  entry.lastAccessed = Date.now();
  saveIndex(entries);
  return filePath;
}

/** Writes a freshly-downloaded file into the cache and returns its absolute path. `displayName` is the
 * real, human-readable file name (with a proper extension already resolved by the caller) — it becomes
 * the actual leaf filename on disk, nested under a hashed subdirectory keyed off providerKey+sourceKey
 * (which still guarantees no collisions between files that happen to share a display name). Without this,
 * every cached file was named after its own base64-encoded cache key, which is what any app that opens
 * the file externally (QuickTime, Preview, etc) shows as its window title. */
export function addToCache(providerKey: string, sourceKey: string, data: Buffer, displayName: string): string {
  ensureDir();
  const entries = loadIndex();
  const keyDir = Buffer.from(cacheKey(providerKey, sourceKey)).toString('base64url');
  const safeName = displayName.replace(/[/\\]/g, '_') || 'file';
  const fileName = path.join(keyDir, safeName);
  const filePath = path.join(CACHE_DIR, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);

  const filtered = entries.filter((e) => cacheKey(e.providerKey, e.sourceKey) !== cacheKey(providerKey, sourceKey));
  filtered.push({ fileName, providerKey, sourceKey, size: data.length, lastAccessed: Date.now() });
  saveIndex(filtered);

  enforceLimit();
  return filePath;
}

export function getCacheStatus(): { usedBytes: number; maxBytes: number } {
  const entries = loadIndex();
  return { usedBytes: entries.reduce((sum, e) => sum + e.size, 0), maxBytes: loadCacheSettings().maxBytes };
}

export function clearCache(): void {
  for (const entry of loadIndex()) {
    try {
      fs.unlinkSync(entryPath(entry));
    } catch {
      // already gone
    }
  }
  saveIndex([]);
}
