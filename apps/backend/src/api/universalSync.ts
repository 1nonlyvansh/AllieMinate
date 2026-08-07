import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { UniversalSyncInvite } from '@alliminate/shared';
import { PERMISSION_TO_DIRECTION } from '@alliminate/shared';
import type { StorageBackend } from '../storage/StorageBackend';
import { emitSyncEvent } from '../events';
import { getDeviceIdentity } from '../device';
import { getSyncPair, createSyncPair, updateSyncPair } from '../sync/syncPairs';
import { startSyncPair } from '../sync/engine';
import { loadInvites, getInvite, addInvite, updateInviteStatus, sendInvites, startInviteRetryLoop } from '../universalSync';

/** Universal Sync Folder — a folder that appears as a normal local folder on every granted device,
 * transparently kept in sync through ONE cloud account held only by the device that creates it (the
 * "host"). Every other granted device gets an ordinary targetKind:'device' SyncPair pointed at the
 * host, exactly like AddSyncPairModal's existing "Paired Device" option already builds — this file only
 * adds the part that doesn't exist yet: the host pushing an invite to each granted device so the pair
 * shows up on their end without them manually setting anything up. */
export function registerUniversalSyncRoutes(app: FastifyInstance, backends: Map<string, StorageBackend>): void {
  startInviteRetryLoop();

  // called BY a host device ON this device — receives and stores an invite this device didn't ask for.
  app.post<{ Body: UniversalSyncInvite }>('/universal-sync/invite', async (req, reply) => {
    const invite = req.body;
    if (!invite?.id || !invite.hostDeviceId || !invite.hostFolderId || !invite.universalSyncId) {
      return reply.code(400).send({ error: 'malformed invite' });
    }
    addInvite(invite);
    emitSyncEvent({ type: 'universal-sync-invite', folderId: invite.id, payload: invite });
    return { ok: true };
  });

  // polled on Sync tab load — covers invites that arrived while this device was offline/closed, same
  // "poll on open" pattern GET /devices/nearby already uses for LAN discovery.
  app.get('/universal-sync/invites', async () => ({
    invites: loadInvites().filter((i) => i.status === 'pending'),
  }));

  app.post<{ Params: { id: string }; Body: { localPath: string; createNew?: boolean } }>(
    '/universal-sync/invites/:id/accept',
    async (req, reply) => {
      const invite = getInvite(req.params.id);
      if (!invite) return reply.code(404).send({ error: 'invite not found' });
      if (invite.status !== 'pending') return reply.code(409).send({ error: `invite already ${invite.status}` });

      const { localPath, createNew } = req.body;
      if (!localPath?.trim()) return reply.code(400).send({ error: 'missing local folder' });
      if (createNew) {
        fs.mkdirSync(localPath, { recursive: true });
      } else if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
        return reply.code(400).send({ error: 'local folder does not exist' });
      }

      const pair = createSyncPair({
        id: crypto.randomUUID(),
        name: invite.name,
        localPath,
        targetKind: 'device',
        deviceId: invite.hostDeviceId,
        deviceFolderId: invite.hostFolderId,
        deviceFolderKind: 'folder',
        remotePath: '',
        direction: PERMISSION_TO_DIRECTION[invite.permission],
        status: 'active',
        createdAt: new Date().toISOString(),
        sourceDeviceName: invite.hostDeviceName,
        universalSyncId: invite.universalSyncId,
      });
      startSyncPair(pair, backends);
      updateInviteStatus(invite.id, 'accepted');
      return { pair };
    },
  );

  app.post<{ Params: { id: string } }>('/universal-sync/invites/:id/decline', async (req, reply) => {
    const invite = getInvite(req.params.id);
    if (!invite) return reply.code(404).send({ error: 'invite not found' });
    updateInviteStatus(invite.id, 'declined');
    return { ok: true };
  });

  // called BY the host device's own UI once its own cloud-backed SyncPair (via the existing POST
  // /sync/pairs) already exists — sends the invite(s) out and tags the host's own pair with the same
  // universalSyncId so the UI can group them later.
  app.post<{
    Body: {
      hostFolderId: string;
      name: string;
      grants: { deviceId: string; permission: UniversalSyncInvite['permission'] }[];
    };
  }>('/universal-sync/create', async (req, reply) => {
    const { hostFolderId, name, grants } = req.body;
    if (!hostFolderId || !name?.trim() || !grants?.length) {
      return reply.code(400).send({ error: 'missing hostFolderId, name, or grants' });
    }
    const hostPair = getSyncPair(hostFolderId);
    if (!hostPair) return reply.code(404).send({ error: 'host sync pair not found' });

    const universalSyncId = crypto.randomUUID();
    updateSyncPair(hostFolderId, { universalSyncId });

    const me = getDeviceIdentity();
    await sendInvites(grants, {
      hostDeviceId: me.id,
      hostDeviceName: me.name,
      hostFolderId,
      universalSyncId,
      name: name.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return { ok: true, universalSyncId };
  });
}
