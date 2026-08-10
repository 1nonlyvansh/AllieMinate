import fs from 'node:fs';
import { dataPath } from './paths';

// The primary Google Drive account (the one configured via .env) has no entry in driveAccounts.json the
// way every "extra" linked account does, so its label can't be renamed through the same store — this is
// the equivalent override for that one account, checked before the live-resolved real email in
// server.ts's resolvePrimaryDriveLabel.
const SETTINGS_PATH = dataPath('primary-drive-label.json');

export function loadPrimaryDriveLabelOverride(): string | undefined {
  if (!fs.existsSync(SETTINGS_PATH)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return typeof data.label === 'string' && data.label.trim() ? data.label.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function savePrimaryDriveLabelOverride(label: string): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ label }, null, 2));
}
