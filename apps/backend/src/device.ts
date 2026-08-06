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

// virtual/tunnel adapters that a peer on the same real WiFi/Ethernet can never actually reach —
// Object.values(os.networkInterfaces()) has no guaranteed order, so picking the first non-internal
// IPv4 could just as easily grab one of these as the real LAN adapter, handing the peer an address
// that resolves fine locally but goes nowhere from outside this machine. This was originally written
// with only macOS/Unix adapter names (utun/awdl/bridge/docker/...) — Windows names these completely
// differently (Hyper-V/WSL's "vEthernet", VirtualBox, VMware, TAP-Windows, VPN clients like Tailscale/
// ZeroTier/WireGuard/OpenVPN), and since this file is shared by both platforms' backends, a Windows
// machine with any of those installed was silently reporting an unreachable virtual-switch IP (e.g.
// a 172.x WSL/Hyper-V range) as its "real" LAN address to every paired peer. Matched by substring, not
// prefix — Windows interface names often have the identifying text in the middle ("Ethernet adapter
// vEthernet (WSL)"), not at the start.
const VIRTUAL_IFACE_SUBSTRINGS = [
  'utun', 'awdl', 'llw', 'bridge', 'vnic', 'ppp', 'ipsec', 'tun', 'tap', 'docker', 'veth',
  'vethernet', 'virtualbox', 'vmware', 'hyper-v', 'wsl', 'npcap', 'loopback',
  'tailscale', 'zerotier', 'wireguard', 'openvpn', 'bluetooth',
];

/** Best-guess LAN-reachable IPv4 address, for showing the user what to type on the other device. Real
 * adapters (en0/Wi-Fi, eth0, Ethernet, etc) win over virtual ones even when a virtual adapter happens
 * to sort first. */
export function getLanAddress(): string | null {
  const interfaces = os.networkInterfaces();
  let fallback: string | null = null;
  for (const [name, entries] of Object.entries(interfaces)) {
    const lower = name.toLowerCase();
    const isVirtual = VIRTUAL_IFACE_SUBSTRINGS.some((s) => lower.includes(s));
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isVirtual) return entry.address;
      if (!fallback) fallback = entry.address;
    }
  }
  return fallback;
}
