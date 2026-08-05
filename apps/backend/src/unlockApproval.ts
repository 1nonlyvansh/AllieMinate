// Receiver side of Phone-Approves-Unlock (Phase 3). Unlike Nearby Share's consent registry, the SENDER
// (the locked device) mints the request id, not the receiver — the sender needs one id to poll against
// every paired device it broadcast to. This only ever gates AllieMinate's own in-app App Lock (the PIN/
// Touch ID screen already in LockScreen.tsx) — it has no path to the OS's actual login/lock screen, which
// no third-party app can bypass.
export type UnlockRequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface UnlockRequest {
  id: string;
  fromName: string;
  status: UnlockRequestStatus;
  createdAt: number;
}

// short-lived on purpose — an unlock approval sitting around for minutes is a stale prompt someone could
// tap by accident (or on purpose, later, having forgotten why). 90s is enough to notice a phone buzz and
// tap it, not enough to linger as a live "yes" long after the moment passed.
const REQUEST_TTL_MS = 90 * 1000;
const requests = new Map<string, UnlockRequest>();

export function createUnlockRequest(id: string, fromName: string): UnlockRequest {
  const request: UnlockRequest = { id, fromName, status: 'pending', createdAt: Date.now() };
  requests.set(id, request);
  return request;
}

export function getUnlockRequest(id: string): UnlockRequest | undefined {
  const request = requests.get(id);
  if (request && request.status === 'pending' && Date.now() - request.createdAt > REQUEST_TTL_MS) {
    request.status = 'expired';
  }
  return request;
}

export function respondToUnlockRequest(id: string, accept: boolean): UnlockRequest | null {
  const request = getUnlockRequest(id);
  if (!request || request.status !== 'pending') return null;
  request.status = accept ? 'accepted' : 'declined';
  return request;
}
