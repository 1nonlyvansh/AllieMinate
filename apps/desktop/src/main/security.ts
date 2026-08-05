import { app, safeStorage, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const SECURITY_PATH = path.join(app.getPath('userData'), 'security.json');

interface SecurityState {
  enabled: boolean;
  pinEncrypted?: string;
}

function load(): SecurityState {
  if (!fs.existsSync(SECURITY_PATH)) return { enabled: false };
  try {
    return JSON.parse(fs.readFileSync(SECURITY_PATH, 'utf-8'));
  } catch {
    return { enabled: false };
  }
}

function save(state: SecurityState): void {
  fs.writeFileSync(SECURITY_PATH, JSON.stringify(state));
}

export function isAppLockEnabled(): boolean {
  return load().enabled;
}

export function setAppLockEnabled(enabled: boolean, pin?: string): void {
  if (enabled && pin) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('secure storage is unavailable on this system');
    }
    save({ enabled: true, pinEncrypted: safeStorage.encryptString(pin).toString('base64') });
    return;
  }
  if (enabled) {
    // re-enabling without a new PIN — keep whatever was there before.
    save({ enabled: true, pinEncrypted: load().pinEncrypted });
    return;
  }
  save({ enabled: false, pinEncrypted: load().pinEncrypted });
}

export function verifyPin(pin: string): boolean {
  const state = load();
  if (!state.pinEncrypted) return false;
  try {
    const stored = safeStorage.decryptString(Buffer.from(state.pinEncrypted, 'base64'));
    return stored === pin;
  } catch {
    return false;
  }
}

export function canUseTouchID(): boolean {
  return process.platform === 'darwin' && systemPreferences.canPromptTouchID();
}

export async function tryTouchID(): Promise<boolean> {
  try {
    await systemPreferences.promptTouchID('unlock AllieMinate');
    return true;
  } catch {
    return false;
  }
}
