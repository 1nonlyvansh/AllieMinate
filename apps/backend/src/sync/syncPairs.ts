import fs from 'node:fs';
import path from 'node:path';
import type { SyncPair } from '@alliminate/shared';
import { dataPath } from '../paths';

// Same JSON-registry pattern as disabledProviders.ts/nearbyShare.ts — deliberately NOT sqlite. The backend
// runs under ELECTRON_RUN_AS_NODE inside the Electron binary, so a native addon like better-sqlite3 would
// need an Electron-ABI rebuild step this repo doesn't have; given the still-unresolved periodic backend
// crash under investigation, a native dependency risks adding a second, indistinguishable crash class right
// when that one's being isolated. JSON scales fine at the file counts a desktop sync client actually sees.
const PAIRS_PATH = dataPath('syncPairs.json');

function loadAll(): SyncPair[] {
  if (!fs.existsSync(PAIRS_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PAIRS_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(pairs: SyncPair[]): void {
  fs.mkdirSync(path.dirname(PAIRS_PATH), { recursive: true });
  fs.writeFileSync(PAIRS_PATH, JSON.stringify(pairs, null, 2));
}

export function listSyncPairs(): SyncPair[] {
  return loadAll();
}

export function getSyncPair(id: string): SyncPair | undefined {
  return loadAll().find((p) => p.id === id);
}

export function createSyncPair(pair: SyncPair): SyncPair {
  const pairs = loadAll();
  pairs.push(pair);
  saveAll(pairs);
  return pair;
}

export function updateSyncPair(id: string, patch: Partial<SyncPair>): SyncPair | undefined {
  const pairs = loadAll();
  const idx = pairs.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  pairs[idx] = { ...pairs[idx], ...patch };
  saveAll(pairs);
  return pairs[idx];
}

export function deleteSyncPair(id: string): void {
  saveAll(loadAll().filter((p) => p.id !== id));
}
