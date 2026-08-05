import crypto from 'node:crypto';
import type { NearbyPeer } from './nearbyDiscovery';
import { getDeviceIdentity } from './device';

// A device we discover via UDP broadcast has no pre-shared token — unlike a paired device, sending it a
// file needs the RECEIVER to explicitly consent per transfer (same trust model AirDrop uses). This tracks
// that consent handshake: sender POSTs a request describing the file, receiver's UI shows accept/decline,
// sender polls until it knows the answer, then uploads the bytes only if accepted.
export type NearbyRequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface NearbyRequest {
  id: string;
  fromId: string;
  fromName: string;
  fileName: string;
  fileSize: number;
  status: NearbyRequestStatus;
  createdAt: number;
}

const REQUEST_TTL_MS = 2 * 60 * 1000;
const requests = new Map<string, NearbyRequest>();

export function createNearbyRequest(fromId: string, fromName: string, fileName: string, fileSize: number): NearbyRequest {
  const id = crypto.randomUUID();
  const request: NearbyRequest = { id, fromId, fromName, fileName, fileSize, status: 'pending', createdAt: Date.now() };
  requests.set(id, request);
  return request;
}

export function getNearbyRequest(id: string): NearbyRequest | undefined {
  const request = requests.get(id);
  if (request && request.status === 'pending' && Date.now() - request.createdAt > REQUEST_TTL_MS) {
    request.status = 'expired';
  }
  return request;
}

export function respondToNearbyRequest(id: string, accept: boolean): NearbyRequest | null {
  const request = getNearbyRequest(id);
  if (!request || request.status !== 'pending') return null;
  request.status = accept ? 'accepted' : 'declined';
  return request;
}

// Sender side of the consent handshake — shared by /nearby/send (bytes already local, e.g. a Finder
// drag-drop onto the tray icon) and /files/send-nearby (bytes fetched server-side from a cloud provider
// first) so both entry points go through the exact same request/poll/upload sequence.
export async function sendBytesToNearbyPeer(
  peer: NearbyPeer,
  name: string,
  data: Buffer,
): Promise<{ ok: boolean; status: 'sent' | 'declined' | 'timed-out' | 'unreachable'; error?: string }> {
  const me = getDeviceIdentity();
  try {
    const requestRes = await fetch(`http://${peer.host}/nearby/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: me.id, fromName: me.name, fileName: name, fileSize: data.length }),
    });
    const requestData = await requestRes.json();
    if (!requestRes.ok || !requestData.requestId) return { ok: false, status: 'unreachable', error: 'device rejected the request' };

    const requestId: string = requestData.requestId;
    // the receiver's user has up to a minute to tap Accept/Decline — same ballpark AirDrop gives before a
    // request just goes stale on its own.
    const deadline = Date.now() + 60_000;
    let status = 'pending';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = await fetch(`http://${peer.host}/nearby/request/${requestId}/status`);
      const statusData = await statusRes.json();
      status = statusData.status;
      if (status !== 'pending') break;
    }

    if (status === 'declined') return { ok: false, status: 'declined' };
    if (status !== 'accepted') return { ok: false, status: 'timed-out' };

    const uploadRes = await fetch(`http://${peer.host}/nearby/request/${requestId}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(data),
    });
    if (!uploadRes.ok) return { ok: false, status: 'unreachable', error: 'upload to device failed' };
    return { ok: true, status: 'sent' };
  } catch (err) {
    return { ok: false, status: 'unreachable', error: err instanceof Error ? err.message : String(err) };
  }
}
