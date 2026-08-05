import fs from 'node:fs';
import { dataPath } from './paths';

const PICKED_PATH = dataPath('photos-picked.json');

export interface PickedMediaItem {
  id: string;
  baseUrl: string;
  filename: string;
  mimeType: string;
  isVideo: boolean;
  creationTime?: string;
  width: number;
  height: number;
}

type PickedStore = Record<string, PickedMediaItem[]>;

function load(): PickedStore {
  if (!fs.existsSync(PICKED_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(PICKED_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function save(store: PickedStore): void {
  fs.writeFileSync(PICKED_PATH, JSON.stringify(store, null, 2));
}

export function getPickedItems(accountId: string): PickedMediaItem[] {
  return load()[accountId] ?? [];
}

// picks accumulate across sessions instead of replacing — a later "Pick photos" trip adds to what's
// already there rather than wiping the previous 1000 the user selected.
export function addPickedItems(accountId: string, items: PickedMediaItem[]): PickedMediaItem[] {
  const store = load();
  const existing = store[accountId] ?? [];
  const byId = new Map(existing.map((i) => [i.id, i]));
  for (const item of items) byId.set(item.id, item);
  store[accountId] = Array.from(byId.values());
  save(store);
  return store[accountId];
}

export function removePickedForAccount(accountId: string): void {
  const store = load();
  delete store[accountId];
  save(store);
}

// "Remove" in the UI — unpicks a single item without touching the actual photo in the user's Google
// Photos library (this app never had delete access to that in the first place, only read access to
// whatever was explicitly picked).
export function removePickedItem(accountId: string, itemId: string): PickedMediaItem[] {
  const store = load();
  store[accountId] = (store[accountId] ?? []).filter((i) => i.id !== itemId);
  save(store);
  return store[accountId];
}
