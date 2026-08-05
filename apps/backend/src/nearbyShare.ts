import fs from 'node:fs';
import { dataPath } from './paths';

const NEARBY_SHARE_PATH = dataPath('nearbyShare.json');

// opt-out, not opt-in — defaults on so a freshly-paired device shows up in the sender's "Nearby Share"
// list right away, matching how the existing all-paired-devices "Devices" drop zone already behaves with
// no gate at all. The toggle exists for the user who wants to stop being a nearby-share target without
// unpairing entirely.
export function loadNearbyShareEnabled(): boolean {
  if (!fs.existsSync(NEARBY_SHARE_PATH)) return true;
  return JSON.parse(fs.readFileSync(NEARBY_SHARE_PATH, 'utf-8')).enabled !== false;
}

export function setNearbyShareEnabled(enabled: boolean): void {
  fs.writeFileSync(NEARBY_SHARE_PATH, JSON.stringify({ enabled }, null, 2));
}
