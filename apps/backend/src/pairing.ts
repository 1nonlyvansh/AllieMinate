import fs from 'node:fs';
import crypto from 'node:crypto';
import { dataPath } from './paths';

const DEVICES_PATH = dataPath('devices.json');
const CODE_TTL_MS = 5 * 60 * 1000;

export interface PairedDevice {
  id: string;
  name: string;
  platform: NodeJS.Platform;
  host: string;
  token: string;
  pairedAt: string;
}

export function loadPairedDevices(): PairedDevice[] {
  if (!fs.existsSync(DEVICES_PATH)) return [];
  return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf-8'));
}

export function savePairedDevices(devices: PairedDevice[]): void {
  fs.writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2));
}

export function findByToken(token: string): PairedDevice | undefined {
  return loadPairedDevices().find((d) => d.token === token);
}

// pending codes this device generated, waiting for a peer to redeem them.
const pendingCodes = new Map<string, number>();
// codes the peer explicitly declined (USB confirm flow's "No") — kept briefly so the Mac's pairing UI can
// show a real rejection message instead of just silently timing out.
const rejectedCodes = new Map<string, number>();
const REJECTED_TTL_MS = 60 * 1000;

export function generatePairingCode(): string {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  pendingCodes.set(code, Date.now() + CODE_TTL_MS);
  return code;
}

export function consumePairingCode(code: string): boolean {
  const expiry = pendingCodes.get(code);
  if (!expiry || Date.now() > expiry) {
    pendingCodes.delete(code);
    return false;
  }
  pendingCodes.delete(code);
  return true;
}

export function rejectPairingCode(code: string): void {
  pendingCodes.delete(code);
  rejectedCodes.set(code, Date.now() + REJECTED_TTL_MS);
}

export function pairingCodeStatus(code: string): 'pending' | 'rejected' | 'unknown' {
  const rejectedExpiry = rejectedCodes.get(code);
  if (rejectedExpiry) {
    if (Date.now() > rejectedExpiry) {
      rejectedCodes.delete(code);
    } else {
      return 'rejected';
    }
  }
  const pendingExpiry = pendingCodes.get(code);
  if (pendingExpiry && Date.now() <= pendingExpiry) return 'pending';
  return 'unknown';
}
