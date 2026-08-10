import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { StorageBackend } from '../storage/StorageBackend';
import { createSyncPair, deleteSyncPair, getSyncPair, listSyncPairs, updateSyncPair } from '../sync/syncPairs';
import { uniqueRemotePrefix } from '../sync/remotePrefix';
import { loadFolders } from '../sync/folders';
import { startSyncPair, stopSyncPairWatch, isSyncPaused, pauseAutoSyncForFolder, resumeAutoSyncForFolder } from '../sync/engine';
import { loadSyncState, deleteSyncState } from '../sync/syncState';
import { getSyncProgress } from '../sync/twoWaySync';
import { getDeviceIdentity } from '../device';
import { categoryForFile, loadOpenWithPrefs } from '../openWith';
import { openLocalFile } from '../openLauncher';

// every file-level route below operates on a plain local path (a Sync Pair's files already live on this
// device's disk — unlike a cloud folder or a peer's folder, there's no download/proxy step needed, just
// containment-checked filesystem access, same caution isAllowedLocalFolderPath already uses elsewhere).
function resolvePairFile(localPath: string, key: string): string | null {
  const resolved = path.resolve(localPath, key);
  const root = path.resolve(localPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

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

  app.get<{ Params: { id: string }; Querystring: { key: string } }>('/sync/pairs/:id/download', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const filePath = resolvePairFile(pair.localPath, req.query.key);
    if (!filePath) return reply.code(403).send({ error: 'path not allowed' });
    try {
      const data = await fs.promises.readFile(filePath);
      reply.header('Content-Type', 'application/octet-stream');
      return reply.send(data);
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  // opens with a specific app (from Settings > Default Apps) or the OS default — same
  // categoryForFile/loadOpenWithPrefs/openLocalFile trio devices.ts already uses for every other
  // "Open in App" action in the codebase.
  app.post<{ Params: { id: string }; Body: { key: string; mimeType?: string } }>('/sync/pairs/:id/open', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const filePath = resolvePairFile(pair.localPath, req.body.key);
    if (!filePath) return reply.code(403).send({ error: 'path not allowed' });
    const name = req.body.key.split('/').pop() ?? req.body.key;
    const category = categoryForFile(name, req.body.mimeType);
    const appPath = category ? loadOpenWithPrefs()[category] : undefined;
    openLocalFile(filePath, appPath, (err) => app.log.error(err, 'failed to open sync pair file'));
    return { ok: true };
  });

  app.delete<{ Params: { id: string }; Querystring: { key: string } }>('/sync/pairs/:id/file', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const filePath = resolvePairFile(pair.localPath, req.query.key);
    if (!filePath) return reply.code(403).send({ error: 'path not allowed' });
    try {
      // a plain unlink — the live chokidar watcher already running for this pair (see engine.ts's
      // syncFolderEvent) picks this up itself and propagates the delete to the cloud and every other
      // granted device on its own, exactly like any other local delete in the synced folder would.
      // "Permanently" here means skipping any provider-side Trash/soft-delete, which propagation already
      // does today for a two-way pair — no separate hard-delete plumbing needed.
      await fs.promises.unlink(filePath);
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.patch<{ Params: { id: string }; Querystring: { key: string; newName: string } }>('/sync/pairs/:id/file', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const { key, newName } = req.query;
    if (!key || !newName || newName.includes('/') || newName.includes('\\')) return reply.code(400).send({ error: 'invalid name' });
    const oldPath = resolvePairFile(pair.localPath, key);
    const newPath = oldPath && resolvePairFile(pair.localPath, path.posix.join(path.posix.dirname(key), newName));
    if (!oldPath || !newPath) return reply.code(403).send({ error: 'path not allowed' });
    try {
      await fs.promises.rename(oldPath, newPath);
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  // Add: a paired device (Android's own remote browser for one of THIS Mac's Sync Pairs) drops a new file
  // straight into the pair's synced folder — same "just write to disk, the live watcher picks it up and
  // propagates" story the DELETE route above already relies on, just for a create instead of a remove.
  app.post<{ Params: { id: string }; Querystring: { name: string; subPath?: string } }>('/sync/pairs/:id/upload', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const name = req.query.name;
    if (!name) return reply.code(400).send({ error: 'missing ?name=' });
    const key = req.query.subPath ? `${req.query.subPath}/${name}` : name;
    const filePath = resolvePairFile(pair.localPath, key);
    if (!filePath) return reply.code(403).send({ error: 'path not allowed' });
    const data = req.body as Buffer;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, data);
    return { ok: true, key, size: data.length };
  });

  // Move: relocate a file to a different subfolder within the same pair — distinct from the rename route
  // above, which only ever changes the filename in place and explicitly rejects a slash in newName.
  app.post<{ Params: { id: string }; Body: { key: string; newSubPath: string } }>('/sync/pairs/:id/move', async (req, reply) => {
    const pair = getSyncPair(req.params.id);
    if (!pair) return reply.code(404).send({ error: 'sync pair not found' });
    const { key, newSubPath } = req.body ?? {};
    if (!key) return reply.code(400).send({ error: 'missing key' });
    const oldPath = resolvePairFile(pair.localPath, key);
    const name = key.split('/').pop() ?? key;
    const newKey = newSubPath ? `${newSubPath}/${name}` : name;
    const newPath = resolvePairFile(pair.localPath, newKey);
    if (!oldPath || !newPath) return reply.code(403).send({ error: 'path not allowed' });
    try {
      await fs.promises.mkdir(path.dirname(newPath), { recursive: true });
      await fs.promises.rename(oldPath, newPath);
      return { ok: true, key: newKey };
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.post<{
    Body: {
      name: string;
      localPath: string;
      direction?: 'two-way' | 'backup-only' | 'download-only';
      createInCloud?: boolean;
      // when set, localPath is created on disk (recursive mkdir) instead of being required to already
      // exist — the Universal Sync Folder wizard's "New Folder" branch uses this so the user can name a
      // folder in-app rather than through the native picker's own "New Folder" button.
      createNew?: boolean;
      // cloud target
      providerId?: string;
      // device target — remoteFolderKind picks which of the peer's folder namespaces remoteFolderId is
      // in: one of its cloud-backed FolderConfig folders, or one of its real local folders (see
      // localFolders.ts) with no cloud account in the loop at all.
      deviceId?: string;
      remoteFolderId?: string;
      remoteFolderKind?: 'folder' | 'local-folder';
      // relative subpath WITHIN remoteFolderId the picker's tree browser drilled into (e.g.
      // "Personal/Me/Photos") — only meaningful when remoteFolderKind === 'local-folder'.
      remoteSubPath?: string;
      // set by CreateUniversalSyncModal — this pair is the HOST side of a Universal Sync Folder, so its
      // cloud storage lands under "Universal Sync/<name>" instead of "Sync/<name>", matching where the
      // Sync tab vs. the Universal Sync feature each actually put things.
      isUniversalSync?: boolean;
    };
  }>('/sync/pairs', async (req, reply) => {
    const { name, localPath, providerId, direction, createInCloud, createNew, deviceId, remoteFolderId, remoteFolderKind, remoteSubPath, isUniversalSync } = req.body;
    if (!name?.trim()) return reply.code(400).send({ error: 'missing name' });
    if (!localPath?.trim()) return reply.code(400).send({ error: 'missing local folder' });
    if (createNew) {
      fs.mkdirSync(localPath, { recursive: true });
    } else if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
      return reply.code(400).send({ error: 'local folder does not exist' });
    }

    if (deviceId) {
      if (!remoteFolderId) return reply.code(400).send({ error: 'missing remote folder on the paired device' });
      const pair = createSyncPair({
        id: crypto.randomUUID(),
        name: name.trim(),
        localPath,
        targetKind: 'device',
        deviceId,
        deviceFolderId: remoteFolderId,
        deviceFolderKind: remoteFolderKind ?? 'folder',
        // subpath WITHIN deviceFolderId the picker's tree browser drilled into — DeviceSyncTarget passes
        // this straight through as ?path= / a name prefix (see syncTarget.ts); '' means "that folder's
        // top level," same as every pair created before nested destinations existed.
        remotePath: remoteFolderKind === 'local-folder' ? (remoteSubPath ?? '') : '',
        direction: direction ?? 'two-way',
        status: 'active',
        createdAt: new Date().toISOString(),
        sourceDeviceName: getDeviceIdentity().name,
      });
      startSyncPair(pair, backends);
      return { pair };
    }

    if (!providerId) return reply.code(400).send({ error: 'missing providerId or deviceId' });
    const backend = backends.get(providerId);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    // same "Sync/<name>" / "Universal Sync/<name>" convention as POST /folders (server.ts) — Drive gets a
    // real nested folder for it, every other provider a real key prefix that already looked like one;
    // Drive additionally gets a real VISIBLE folder object elsewhere in "My Drive" when createInCloud is
    // set (createVisibleFolder), unrelated to this managed-storage path. Checked against every other Sync
    // Pair AND every pinned/Auto-Sync FolderConfig on this account, since both write into the same managed
    // cloud root.
    const remotePath = uniqueRemotePrefix(isUniversalSync ? 'Universal Sync' : 'Sync', name, [
      ...listSyncPairs().map((p) => p.remotePath),
      ...loadFolders().map((f) => f.remotePrefix),
    ]);

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
    const backend = pair.targetKind === 'cloud' ? backends.get(pair.providerId ?? '') : undefined;
    if (pair.targetKind === 'cloud' && !backend) return reply.code(409).send({ error: 'provider not reachable' });
    // resumeAutoSyncForFolder just restarts the reconciliation interval — the live push watcher (started
    // by startSyncPair originally) was never stopped by pause, only the interval was, so no need to touch
    // it. resolveSyncTarget ignores `backend` entirely for a device-target pair, so undefined is fine there.
    resumeAutoSyncForFolder(
      {
        id: pair.id,
        name: pair.name,
        localPath: pair.localPath,
        provider: pair.providerId ?? '',
        remotePrefix: pair.remotePath,
        autoSync: true,
        syncTargetKind: pair.targetKind,
        syncDeviceId: pair.deviceId,
        syncDeviceFolderId: pair.deviceFolderId,
        syncDeviceFolderKind: pair.deviceFolderKind,
      },
      backend,
    );
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
