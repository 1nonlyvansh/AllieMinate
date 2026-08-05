import fs from 'node:fs';
import { dataPath } from './paths';

const ACCOUNTS_PATH = dataPath('photos-accounts.json');

export interface PhotosAccount {
  /** e.g. "photos:1" */
  accountId: string;
  label: string;
  email: string;
  refreshToken: string;
}

export function loadPhotosAccounts(): PhotosAccount[] {
  if (!fs.existsSync(ACCOUNTS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

export function savePhotosAccounts(accounts: PhotosAccount[]): void {
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

export function nextPhotosAccountId(existing: PhotosAccount[]): string {
  const ids = new Set(existing.map((a) => a.accountId));
  let n = 1;
  while (ids.has(`photos:${n}`)) n++;
  return `photos:${n}`;
}
