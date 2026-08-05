import fs from 'node:fs';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { StorageBackend } from '../storage/StorageBackend';
import { createSyncPair, deleteSyncPair, getSyncPair, listSyncPairs, updateSyncPair } from '../sync/syncPairs';
import { startSyncPair, stopSyncPairWatch, isSyncPaused, pauseAutoSyncForFolder, resumeAutoSyncForFolder } from '../sync/engine';
import { loadSyncState, deleteSyncState } from '../sync/syncState';
import { getSyncProgress } from '../sync/twoWaySync';
import { getDeviceIdentity } from '../device';

// Sync Engine (Phase 3/4): freestanding Sync Pairs — pick any local folder first, then choose which
// account it syncs to. Distinct from the pinned-folder Auto-Sync toggle (providers.ts), which upgrades a
// folder that already belongs to one cloud account; a Sync Pair has no pinned-folder association at all.
export function registerSyncPairRoutes(app: FastifyInstance, backends: Map<string, StorageBackend>): void {
  app.get('/sync/pairs', async () => ({
    pairs: listSyncPairs().map((p) => {
      const state = loadSyncState(p.id);
      const files = Object.values(state);
      return {
        ...p,
        paused: p.status === 'active' && isSyncPaused(p.id),
        fileCounts: {
          synced: files.filter((f) => f.status === 'synced' || (!f.status && f.lastSyncedAt)).length,
          error: files.filter((f) => f.status === 'error' || f.status === 'waiting-network').length,
          total: files.length,
        },
        progress: getSyncProgress(p.id) ?? null,
      };
    }),
  }));

  app.get<{ Params: { id: string } }>('/sync/pairs/:id/files', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const state = loadSyncState(pair.id);
    return { files: Object.entries(state).map(([relPath, record]) => ({ relPath, ...record })) };
  });

  app.post<{
    Body: { name: string; localPath: string; providerId: string; direction?: 'two-way' | 'backup-only' | 'download-only'; createInCloud?: boolean };
  }>('/sync/pairs', async (req, reply) => {
    const { name, localPath, providerId, direction, createInCloud } = req.body;
    if (!name?.trim()) return reply.code(400).send({ error: 'missing name' });
    if (!localPath?.trim()) return reply.code(400).send({ error: 'missing local folder' });
    if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
      return reply.code(400).send({ error: 'local folder does not exist' });
    }
    const backend = backends.get(providerId);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    // same slug+random-suffix convention as POST /folders (server.ts) — every other provider organizes
    // storage by flat key prefix, so this is the one consistent "destination path" concept across all of
    // them; Drive additionally gets a real visible folder object when createInCloud is set.
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sync';
    const remotePath = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

    if (createInCloud && backend.createVisibleFolder) {
      try {
        await backend.createVisibleFolder(name.trim());
      } catch (err) {
        return reply.code(502).send({ error: `Couldn't create the folder in the cloud: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    const pair = createSyncPair({
      id: crypto.randomUUID(),
      name: name.trim(),
      localPath,
      targetKind: 'cloud',
      providerId,
      remotePath,
      direction: direction ?? 'two-way',
      status: 'active',
      createdAt: new Date().toISOString(),
      sourceDeviceName: getDeviceIdentity().name,
    });

    startSyncPair(pair, backends);
    return { pair };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; direction?: 'two-way' | 'backup-only' | 'download-only' } }>(
    '/sync/pairs/:id',
    async (req, reply) => {
      const pair = getSyncPair(req.params.id);
      if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
      const patch: Record<string, unknown> = {};
      if (req.body.name?.trim()) patch.name = req.body.name.trim();
      if (req.body.direction) patch.direction = req.body.direction;
      const updated = updateSyncPair(pair.id, patch);
      // the running watcher/reconciliation closure captured the OLD direction at startSyncPair() time —
      // restarting picks up the change immediately instead of it silently taking effect only after the
      // next app restart. startSyncPair() already stops the old watcher first as its own double-start guard.
      if (updated && updated.status === 'active' && !isSyncPaused(updated.id)) {
        startSyncPair(updated, backends);
      }
      return { pair: updated };
    },
  );

  app.post<{ Params: { id: string } }>('/sync/pairs/:id/pause', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    pauseAutoSyncForFolder(pair.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/sync/pairs/:id/resume', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const backend = backends.get(pair.providerId ?? '');
    if (!backend) return reply.code(409).send({ error: 'provider not reachable' });
    // resumeAutoSyncForFolder just restarts the reconciliation interval — the live push watcher (started
    // by startSyncPair originally) was never stopped by pause, only the interval was, so no need to touch it.
    resumeAutoSyncForFolder({ id: pair.id, name: pair.name, localPath: pair.localPath, provider: pair.providerId ?? '', remotePrefix: pair.remotePath, autoSync: true }, backend);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/sync/pairs/:id', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    stopSyncPairWatch(pair.id);
    deleteSyncPair(pair.id);
    deleteSyncState(pair.id);
    // local files and any Sync Trash contents are never touched — deleting a pair only unconfigures sync,
    // same promise the pinned-folder Auto-Sync disable route already makes.
    return { ok: true };
  });
}
