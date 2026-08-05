import dgram from 'node:dgram';
import { getDeviceIdentity } from './device';
import { loadNearbyShareEnabled } from './nearbyShare';

// plain UDP broadcast, not mDNS/Bonjour — every AllieMinate instance on the LAN periodically shouts "I'm
// here" on this fixed port, and anyone listening builds a live map of who's currently reachable. No
// dependency, no service records, good enough for "phones and PCs on the same WiFi see each other".
const NEARBY_PORT = 41310;
const BEACON_INTERVAL_MS = 3000;
const PEER_STALE_MS = 10_000;

export interface NearbyPeer {
  id: string;
  name: string;
  platform: string;
  host: string;
  lastSeen: number;
}

const peers = new Map<string, NearbyPeer>();
let socket: dgram.Socket | null = null;

export function startNearbyDiscovery(appPort: number): void {
  if (socket) return;
  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data?.type !== 'alliminate-nearby' || typeof data.id !== 'string') return;
      const me = getDeviceIdentity();
      if (data.id === me.id) return; // our own beacon, bounced back by broadcast
      if (data.nearbyShareEnabled === false) {
        peers.delete(data.id);
        return;
      }
      peers.set(data.id, {
        id: data.id,
        name: typeof data.name === 'string' ? data.name : 'Unknown Device',
        platform: typeof data.platform === 'string' ? data.platform : 'unknown',
        host: `${rinfo.address}:${typeof data.port === 'number' ? data.port : appPort}`,
        lastSeen: Date.now(),
      });
    } catch {
      // this socket takes unauthenticated input from anything on the LAN — malformed/hostile packets are
      // just ignored, never trusted or acted on beyond "maybe update the nearby list".
    }
  });

  socket.on('error', (err) => console.error('nearby discovery socket error:', err.message));

  socket.bind(NEARBY_PORT, () => {
    socket?.setBroadcast(true);
  });

  setInterval(() => {
    const now = Date.now();
    for (const [id, peer] of peers) {
      if (now - peer.lastSeen > PEER_STALE_MS) peers.delete(id);
    }

    if (!loadNearbyShareEnabled()) return;
    const me = getDeviceIdentity();
    const payload = Buffer.from(
      JSON.stringify({ type: 'alliminate-nearby', id: me.id, name: me.name, platform: me.platform, port: appPort, nearbyShareEnabled: true }),
    );
    socket?.send(payload, NEARBY_PORT, '255.255.255.255', (err) => {
      if (err) console.error('nearby beacon send failed:', err.message);
    });
  }, BEACON_INTERVAL_MS);
}

export function getNearbyPeers(): NearbyPeer[] {
  return Array.from(peers.values());
}
