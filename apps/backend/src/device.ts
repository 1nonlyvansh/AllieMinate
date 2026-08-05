import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { dataPath } from './paths';

const DEVICE_PATH = dataPath('device.json');

export interface DeviceIdentity {
  id: string;
  name: string;
  platform: NodeJS.Platform;
}

let cached: DeviceIdentity | null = null;

export function getDeviceIdentity(): DeviceIdentity {
  if (cached) return cached;

  if (fs.existsSync(DEVICE_PATH)) {
    cached = JSON.parse(fs.readFileSync(DEVICE_PATH, 'utf-8'));
    return cached as DeviceIdentity;
  }

  const identity: DeviceIdentity = {
    id: crypto.randomUUID(),
    name: os.hostname().replace(/\.local$/, ''),
    platform: process.platform,
  };
  fs.writeFileSync(DEVICE_PATH, JSON.stringify(identity, null, 2));
  cached = identity;
  return identity;
}

// virtual/tunnel adapters (VPN, AirDrop's awdl, Thunderbolt Bridge, Docker, PPP) that a phone on the same
// WiFi can never actually reach — Object.values(os.networkInterfaces()) has no guaranteed order, so
// picking the first non-internal IPv4 could just as easily grab one of these as the real WiFi adapter,
// handing the phone an address it can connect to over LAN but that silently goes nowhere.
const VIRTUAL_IFACE_PREFIXES = ['utun', 'awdl', 'llw', 'bridge', 'vnic', 'ppp', 'ipsec', 'tun', 'tap', 'docker', 'veth'];

/** Best-guess LAN-reachable IPv4 address, for showing the user what to type on the other device. Real
 * adapters (en0/Wi-Fi, eth0, etc) win over virtual ones even when a virtual adapter happens to sort first. */
export function getLanAddress(): string | null {
  const interfaces = os.networkInterfaces();
  let fallback: string | null = null;
  for (const [name, entries] of Object.entries(interfaces)) {
    const isVirtual = VIRTUAL_IFACE_PREFIXES.some((p) => name.toLowerCase().startsWith(p));
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isVirtual) return entry.address;
      if (!fallback) fallback = entry.address;
    }
  }
  return fallback;
}
