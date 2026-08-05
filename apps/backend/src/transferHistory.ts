import fs from 'node:fs';
import crypto from 'node:crypto';
import { dataPath } from './paths';

const HISTORY_PATH = dataPath('transferHistory.json');
const MAX_ENTRIES = 500;

export interface TransferEntry {
  id: string;
  deviceId: string;
  deviceName: string;
  fileName: string;
  direction: 'sent' | 'received';
  date: string;
  size: number;
  path: string;
}

export function loadTransferHistory(): TransferEntry[] {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTransferHistory(history: TransferEntry[]): void {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(0, MAX_ENTRIES), null, 2));
}

export function logTransfer(entry: Omit<TransferEntry, 'id' | 'date'>): void {
  const history = loadTransferHistory();
  history.unshift({ ...entry, id: crypto.randomUUID(), date: new Date().toISOString() });
  saveTransferHistory(history);
}

export function removeTransferEntry(id: string): void {
  saveTransferHistory(loadTransferHistory().filter((e) => e.id !== id));
}

export function findTransferEntry(id: string): TransferEntry | undefined {
  return loadTransferHistory().find((e) => e.id === id);
}

/** Renames the actual file on disk (these entries always point at a real local path — the Mac's own
 * Downloads folder or wherever a push landed) and keeps the history entry's fileName/path in sync. */
export function renameTransferFile(id: string, newName: string): { ok: boolean; error?: string } {
  const history = loadTransferHistory();
  const entry = history.find((e) => e.id === id);
  if (!entry) return { ok: false, error: 'not found' };
  if (!fs.existsSync(entry.path)) return { ok: false, error: 'the original file is no longer at that path' };

  const dir = entry.path.slice(0, entry.path.length - entry.fileName.length);
  const newPath = dir + newName;
  try {
    fs.renameSync(entry.path, newPath);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  entry.fileName = newName;
  entry.path = newPath;
  saveTransferHistory(history);
  return { ok: true };
}
