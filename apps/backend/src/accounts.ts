import fs from 'node:fs';
import { dataPath } from './paths';

const ACCOUNTS_PATH = dataPath('accounts.json');

export interface DriveAccount {
  /** e.g. "google-drive:2" — the second linked Drive account */
  accountId: string;
  label: string;
  /** the Google account's real email, captured at link time — used for duplicate detection even after label is renamed. */
  email: string;
  refreshToken: string;
}

export function loadDriveAccounts(): DriveAccount[] {
  if (!fs.existsSync(ACCOUNTS_PATH)) return [];
  const accounts: DriveAccount[] = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));

  // The add-account flow's own dedupe check (providers.ts) only runs at link time and can be bypassed by a
  // transient userinfo lookup failure or a double-fired OAuth callback — either leaves a second accounts.json
  // row for the same real Google account. Nothing downstream (storage totals, the Files filter, Settings)
  // ever re-checks, so a slipped-through duplicate is permanent and shows up everywhere. Self-heal on every
  // load: keep the first occurrence of each non-empty email, drop the rest, and persist the cleaned list so
  // this doesn't need to re-run the same dedupe logic in every caller.
  const seenEmails = new Set<string>();
  const deduped = accounts.filter((a) => {
    if (!a.email) return true;
    if (seenEmails.has(a.email)) return false;
    seenEmails.add(a.email);
    return true;
  });
  if (deduped.length !== accounts.length) saveDriveAccounts(deduped);

  return deduped;
}

export function saveDriveAccounts(accounts: DriveAccount[]): void {
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

export function nextDriveAccountId(existing: DriveAccount[]): string {
  const ids = new Set(existing.map((a) => a.accountId));
  let n = 2;
  while (ids.has(`google-drive:${n}`)) n++;
  return `google-drive:${n}`;
}
