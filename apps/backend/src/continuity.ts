import { getDeviceIdentity } from './device';
import { loadPairedDevices } from './pairing';

const BROADCAST_TIMEOUT_MS = 2000;

export interface ContinuityPayload {
  fileName: string;
  providerId: string;
  key: string;
  mimeType?: string;
}

// Fire-and-forget "now viewing X" presence signal to every paired device — a phone shows a "Continue on
// this phone?" notification, a desktop peer with no /continuity route just 404s silently. Best-effort by
// design: this is a convenience nudge, not a guaranteed-delivery transfer, so failures are swallowed the
// same way other cross-device pushes in this app already do (see devices.ts's fire-and-forget patterns).
export function broadcastContinuity(payload: ContinuityPayload): void {
  const fromName = getDeviceIdentity().name;
  for (const device of loadPairedDevices()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);
    fetch(`http://${device.host}/continuity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({ fromName, ...payload }),
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }
}
