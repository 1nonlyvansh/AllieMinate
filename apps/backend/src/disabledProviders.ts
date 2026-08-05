import fs from 'node:fs';
import { dataPath } from './paths';

const DISABLED_PROVIDERS_PATH = dataPath('disabledProviders.json');

// "Log Out" (per-provider or "Log Out of All Services") used to only do `backends.delete(id)` — a plain
// in-memory removal with nothing persisted. The confirm dialog for it says "saved credentials stay in
// .env — this just disconnects the app", which was true of the credentials but not of the disconnect
// itself: without this, a force-quit + reopen re-read the same .env/driveAccounts.json on boot and
// reconnected every "logged out" provider right back, which is exactly the surprise a Log Out button
// should never produce. This tracks which provider ids the user explicitly logged out of, so boot-time
// backend construction can skip them — the credentials really do stay put, only the connection stays off
// until the user clicks Log In again (which clears the flag).
function load(): string[] {
  if (!fs.existsSync(DISABLED_PROVIDERS_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(DISABLED_PROVIDERS_PATH, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  fs.writeFileSync(DISABLED_PROVIDERS_PATH, JSON.stringify(ids, null, 2));
}

export function loadDisabledProviders(): string[] {
  return load();
}

export function isProviderDisabled(id: string): boolean {
  return load().includes(id);
}

export function setProviderDisabled(id: string, disabled: boolean): void {
  const ids = load().filter((x) => x !== id);
  if (disabled) ids.push(id);
  save(ids);
}
