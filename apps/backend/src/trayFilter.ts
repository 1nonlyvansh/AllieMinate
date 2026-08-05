import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './paths';

const FILTER_PATH = dataPath('trayFilter.json');

/** null = combined view across every connected cloud (the default). A specific value is a provider id
 * (e.g. "mega", "google-drive:2") — the tray's own Recent Cloud Files dropdown then shows only that
 * account's files instead of the merged feed. Set from inside the tray panel itself (see /recent's
 * ?provider= handling in server.ts), persisted here purely to restore the last selection on next open. */
export function loadTrayFilterProvider(): string | null {
  if (!fs.existsSync(FILTER_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILTER_PATH, 'utf-8'));
    return typeof parsed.providerId === 'string' && parsed.providerId ? parsed.providerId : null;
  } catch {
    return null;
  }
}

export function saveTrayFilterProvider(providerId: string | null): void {
  fs.mkdirSync(path.dirname(FILTER_PATH), { recursive: true });
  fs.writeFileSync(FILTER_PATH, JSON.stringify({ providerId }, null, 2));
}
