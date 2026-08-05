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
  return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
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
