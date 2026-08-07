import fs from 'node:fs';
import crypto from 'node:crypto';
import type { UniversalSyncInvite } from '@alliminate/shared';
import { dataPath } from './paths';
import { loadPairedDevices } from './pairing';

const INVITES_PATH = dataPath('universalSyncInvites.json');

/** Invites THIS device has RECEIVED (from a host) — pending/accepted/declined, persisted (unlike the
 * in-memory nearby-share/unlock-approval registries) since a Universal Sync invite must survive the
 * target device being offline or the app being closed when it arrives. */
export function loadInvites(): UniversalSyncInvite[] {
  if (!fs.existsSync(INVITES_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(INVITES_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInvites(invites: UniversalSyncInvite[]): void {
  fs.writeFileSync(INVITES_PATH, JSON.stringify(invites, null, 2));
}

export function getInvite(id: string): UniversalSyncInvite | undefined {
  return loadInvites().find((i) => i.id === id);
}

export function addInvite(invite: UniversalSyncInvite): void {
  const invites = loadInvites().filter((i) => i.id !== invite.id);
  invites.push(invite);
  saveInvites(invites);
}

export function updateInviteStatus(id: string, status: 'accepted' | 'declined'): UniversalSyncInvite | undefined {
  const invites = loadInvites();
  const invite = invites.find((i) => i.id === id);
  if (!invite) return undefined;
  invite.status = status;
  saveInvites(invites);
  return invite;
}

// --- host-side delivery: invites THIS device (as host) still needs to push to a peer that was
// unreachable at creation time. Retried on a small dedicated interval — the only other backend-owned
// timer in the codebase is the sync engine's own reconciliation loop (sync/engine.ts), same shape here. ---

interface PendingDelivery {
  deviceId: string;
  invite: UniversalSyncInvite;
}

const PENDING_PATH = dataPath('universalSyncPending.json');
const RETRY_INTERVAL_MS = 2 * 60 * 1000;
const DELIVER_TIMEOUT_MS = 4000;

function loadPending(): PendingDelivery[] {
  if (!fs.existsSync(PENDING_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePending(pending: PendingDelivery[]): void {
  fs.writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2));
}

async function deliverInvite(host: string, token: string, invite: UniversalSyncInvite): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}/universal-sync/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(invite),
      signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sends one invite per grant to its device now; whichever don't answer are queued for retry. Each
 * grant gets its own invite id (recipients accept/decline independently), all sharing one
 * `universalSyncId` for UI grouping. */
export async function sendInvites(
  grants: { deviceId: string; permission: UniversalSyncInvite['permission'] }[],
  base: Omit<UniversalSyncInvite, 'id' | 'permission'>,
): Promise<void> {
  const paired = loadPairedDevices();
  const stillPending = loadPending();
  for (const { deviceId, permission } of grants) {
    const peer = paired.find((d) => d.id === deviceId);
    if (!peer) continue; // not actually paired — nothing to invite
    const invite: UniversalSyncInvite = { ...base, permission, id: crypto.randomUUID() };
    const delivered = await deliverInvite(peer.host, peer.token, invite);
    if (!delivered) stillPending.push({ deviceId, invite });
  }
  savePending(stillPending);
}

let retryTimer: ReturnType<typeof setInterval> | null = null;

/** Idempotent — safe to call every time routes are registered (once per backend start). */
export function startInviteRetryLoop(): void {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    const pending = loadPending();
    if (pending.length === 0) return;
    const paired = loadPairedDevices();
    const stillPending: PendingDelivery[] = [];
    for (const item of pending) {
      const peer = paired.find((d) => d.id === item.deviceId);
      if (!peer) continue; // unpaired since queuing — drop
      const delivered = await deliverInvite(peer.host, peer.token, item.invite);
      if (!delivered) stillPending.push(item);
    }
    savePending(stillPending);
  }, RETRY_INTERVAL_MS);
}
