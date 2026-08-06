import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import type { FolderConfig, SyncEvent } from '@alliminate/shared';
import { PROVIDER_QUOTA_BYTES, baseProviderOf } from '@alliminate/shared';
import type { StorageBackend } from '../storage/StorageBackend';
import { syncEvents, emitSyncEvent } from '../events';
import { loadTrash, saveTrash, withoutTrash } from '../trash';
import { loadDriveAccounts, saveDriveAccounts } from '../accounts';
import { saveFolders } from '../sync/folders';
import { registerProviderRoutes } from './providers';
import { registerDeviceRoutes } from './devices';
import { registerLocalOpenRoutes } from './localOpen';
import { registerSearchRoutes } from './search';
import { registerPhotosRoutes } from './photos';
import { registerSettingsRoutes } from './settings';
import { registerLogRoutes } from './logs';
import { registerSyncPairRoutes } from './syncPairs';
import { registerLocalFolderRoutes } from './localFolders';
import { findByToken } from '../pairing';
import { loadMasterDeviceEnabled } from '../masterDevice';
import { logTransfer, loadTransferHistory, removeTransferEntry, renameTransferFile, findTransferEntry } from '../transferHistory';
import { loadReceivePath } from '../receiveSettings';
import { loadNearbyShareEnabled } from '../nearbyShare';
import { getNearbyPeers } from '../nearbyDiscovery';
import { createNearbyRequest, getNearbyRequest, respondToNearbyRequest, sendBytesToNearbyPeer } from '../nearbyTransfer';
import { createUnlockRequest, getUnlockRequest, respondToUnlockRequest } from '../unlockApproval';
import { getDeviceIdentity } from '../device';
import { isSyncPaused } from '../sync/engine';
import { getSyncProgress } from '../sync/twoWaySync';
import { loadTrayFilterProvider, saveTrayFilterProvider } from '../trayFilter';
import { listLocalRecentFiles, isAllowedLocalPath } from '../localFiles';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { config } from '../config';

// Deleting trash entries fully sequentially (one cloud API round-trip at a time) is what made "Empty
// Trash" feel hung on a large trash — hundreds of phone-synced photos moved to trash at once (e.g.
// deleting a Sync Pair) took minutes to grind through one file per await. Bounded concurrency keeps it
// fast without firing hundreds of requests at a provider simultaneously.
const TRASH_DELETE_CONCURRENCY = 5;
// Returns the items whose `run` call FAILED — callers that persist "what's left" (trash.json after an
// empty/expiry sweep) need this: swallowing every error and unconditionally saving an empty list was
// letting a failed cloud delete (rate limit, transient network blip) silently wipe that entry's only
// record while the actual file stayed sitting on the provider, orphaned with no way for AllieMinate's own
// Trash view to ever see or retry it again.
async function deleteAllConcurrently<T>(items: T[], run: (item: T) => Promise<void>): Promise<T[]> {
  let i = 0;
  const failed: T[] = [];
  await Promise.all(
    Array.from({ length: Math.min(TRASH_DELETE_CONCURRENCY, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await run(item).catch(() => failed.push(item));
      }
    }),
  );
  return failed;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// /nearby/request* is reachable by ANY device on the LAN, paired or not — that's the whole point (an
// unpaired sender has no token to present). Consent lives in the accept/decline step itself, not in auth.
const PUBLIC_LAN_PREFIXES = ['/pair/', '/device-info', '/nearby/request'];

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface StorageEntry {
  provider: string;
  usedBytes: number;
  totalBytes?: number;
  label?: string;
}

// module-level (not per-request) so the cache survives across every /storage call for the life of the
// process — cleared only by a full backend restart, which is fine: a stale-by-a-few-minutes storage
// number is a non-issue, a UI that can't show ANY number until the slowest provider answers is the actual
// bug this exists to fix.
const storageCache = new Map<string, StorageEntry>();
const storageRefreshing = new Set<string>();
const storageFailedAt = new Map<string, number>();
// a provider that's genuinely broken right now (e.g. a real account-level API quota/transaction cap
// exceeded, seen live on B2) used to get re-hit on literally EVERY /storage poll forever, since a failure
// was never cached — with several surfaces polling (main window, tray, devices view) that's a live API
// call every few seconds, which for an already-capped account just keeps failing and burns the day's
// quota further. Skip retrying a provider that failed recently instead of hammering it every poll.
const STORAGE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

async function refreshProviderStorage(
  accountId: string,
  backend: StorageBackend,
  labelFor: (accountId: string) => string | undefined,
): Promise<StorageEntry | null> {
  // a second caller arriving while a refresh for this exact provider is already in flight (e.g. two
  // /storage requests a second apart, both finding a stale-but-present cache entry) would otherwise kick
  // off a duplicate lookup against the same slow provider for no benefit — the one already running will
  // populate the cache for both.
  if (storageRefreshing.has(accountId)) return storageCache.get(accountId) ?? null;
  const failedAt = storageFailedAt.get(accountId);
  if (failedAt && Date.now() - failedAt < STORAGE_FAILURE_COOLDOWN_MS) return storageCache.get(accountId) ?? null;
  storageRefreshing.add(accountId);
  try {
    const real = backend.getAccountUsage ? await backend.getAccountUsage().catch(() => null) : null;
    let entry: StorageEntry;
    if (real) {
      entry = { provider: accountId, usedBytes: real.usedBytes, totalBytes: real.totalBytes, label: labelFor(accountId) };
    } else {
      const files = await backend.list('');
      const usedBytes = files.reduce((sum, f) => sum + f.size, 0);
      entry = { provider: accountId, usedBytes, totalBytes: PROVIDER_QUOTA_BYTES[baseProviderOf(accountId)], label: labelFor(accountId) };
    }
    storageCache.set(accountId, entry);
    storageFailedAt.delete(accountId);
    // tells the renderer's WebSocket listener to refetch /storage — same "something changed, go refresh"
    // mechanism file-synced events already use. Harmless to fire even when nothing visually changed (a
    // provider that was already cached and just re-confirmed the same number).
    emitSyncEvent({ type: 'storage-updated', folderId: accountId, payload: entry });
    return entry;
  } catch (err) {
    console.error(`storage usage lookup failed for ${accountId}:`, err instanceof Error ? err.message : err);
    storageFailedAt.set(accountId, Date.now());
    return storageCache.get(accountId) ?? null;
  } finally {
    storageRefreshing.delete(accountId);
  }
}

export async function buildServer(
  backends: Map<string, StorageBackend>,
  folders: FolderConfig[],
): Promise<FastifyInstance> {
  // ceiling for any single upload (phone-to-Mac share, provider upload, folder upload) — matches the cap
  // enforced on the Android sending side (ShareScreen.kt's MAX_SHARE_BYTES).
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 * 1024 });

  // renderer loads over file:// (origin "null") — allow it through for local dev.
  await app.register(cors, { origin: true });
  await app.register(websocketPlugin);

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // requests from the local renderer (loopback) stay unauthenticated, same as always.
  // anything arriving over the LAN must present a valid paired-device token.
  app.addHook('onRequest', async (req, reply) => {
    const remote = req.socket.remoteAddress ?? '';
    if (LOOPBACK_ADDRESSES.has(remote)) return;
    if (PUBLIC_LAN_PREFIXES.some((p) => req.url.startsWith(p))) return;

    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !findByToken(token)) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  registerProviderRoutes(app, backends, folders);
  registerDeviceRoutes(app, backends);
  registerLocalOpenRoutes(app, backends, folders);
  registerSearchRoutes(app, backends);
  registerPhotosRoutes(app);
  registerSettingsRoutes(app);
  registerLogRoutes(app);
  registerSyncPairRoutes(app, backends);
  registerLocalFolderRoutes(app);

  app.get('/status', async () => ({
    ok: true,
    providers: Array.from(backends.keys()),
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      provider: f.provider,
      remotePrefix: f.remotePrefix,
      remoteFolderId: f.remoteFolderId,
      pinned: f.pinned !== false,
      // Phase 5: Auto-Sync — hasLocalPath (not the raw path itself, no reason to leak absolute filesystem
      // paths to LAN peers reading this same route) tells the UI whether Auto-Sync is even offerable at
      // all for this folder (pinned/library folders with no localPath can't be).
      hasLocalPath: !!f.localPath,
      autoSync: f.autoSync === true,
      syncTargetKind: f.syncTargetKind,
      syncDeviceId: f.syncDeviceId,
      syncPaused: f.autoSync === true && isSyncPaused(f.id),
      syncProgress: f.autoSync === true ? getSyncProgress(f.id) ?? null : null,
    })),
    // read by a paired peer's own /devices call (via testConnection) to decide whether THIS device should
    // show up in that peer's "Nearby Share" list — a device that's paired but opted out still works
    // through the existing full Devices browsing, it just won't be offered as a quick-drop target.
    nearbyShareEnabled: loadNearbyShareEnabled(),
    // also read off this same /status body by a paired peer's testConnection — Master/Under is a
    // relationship computed from real state (own clouds + this toggle + reachability), never from which OS
    // either side happens to run, so a peer needs both of these to work out whether THIS device currently
    // qualifies as its Master.
    masterDeviceEnabled: loadMasterDeviceEnabled(),
  }));

  // creates a brand-new empty pinned folder on a chosen cloud account — nothing needs to exist remotely
  // yet, the prefix just materializes the moment the first file gets uploaded into it.
  app.post<{ Body: { name: string; provider: string; createInCloud?: boolean; remoteFolderId?: string } }>('/folders', async (req, reply) => {
    const { name, provider, createInCloud, remoteFolderId } = req.body;
    if (!name?.trim()) return reply.code(400).send({ error: 'missing name' });
    const backend = backends.get(provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    // Pinning a REAL, pre-existing folder picked from the account's actual tree (/providers/:id/tree) —
    // no remotePrefix slug needed at all, reads go through browseFolder(remoteFolderId) instead.
    if (remoteFolderId) {
      const folder: FolderConfig = {
        id: crypto.randomUUID(),
        name: name.trim(),
        localPath: '',
        provider,
        remotePrefix: '',
        remoteFolderId,
        pinned: true,
      };
      folders.push(folder);
      saveFolders(folders);
      return { folder, cloudFolderCreated: false };
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'folder';
    const remotePrefix = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

    let cloudFolderCreated = false;
    if (createInCloud && backend.createVisibleFolder) {
      try {
        await backend.createVisibleFolder(name.trim());
        cloudFolderCreated = true;
      } catch (err) {
        return reply.code(502).send({ error: `Couldn't create the folder in the cloud: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    const folder: FolderConfig = {
      id: crypto.randomUUID(),
      name: name.trim(),
      localPath: '',
      provider,
      remotePrefix,
      pinned: true,
    };
    folders.push(folder);
    saveFolders(folders);
    return { folder, cloudFolderCreated };
  });

  // lets Settings show "needs setup" for OAuth providers whose .env client id/secret aren't filled in yet,
  // instead of letting the user click Log In and only finding out after the fact.
  app.get('/config-status', async () => ({
    pcloudConfigured: !!(process.env.PCLOUD_CLIENT_ID && process.env.PCLOUD_CLIENT_SECRET),
    onedriveConfigured: !!(process.env.ONEDRIVE_CLIENT_ID && process.env.ONEDRIVE_CLIENT_SECRET),
  }));

  // aggregated recent files across every synced folder — used by the Overview grid and the tray icon's idle-click menu.
  // fans out to every folder's provider IN PARALLEL — this used to await each folder's backend.list() one at a
  // time in a for-loop, so N folders across N slow cloud APIs summed their latencies instead of overlapping
  // them, which is exactly what made the tray's "Recent Cloud Files" feel sluggish with more than a couple
  // of folders configured.
  app.get<{ Querystring: { limit?: string; provider?: string } }>('/recent', async (req) => {
    const limit = Math.min(50, Number(req.query.limit ?? 10) || 10);
    // an explicit ?provider= (the tray's own dropdown, right there in the panel, always sends its current
    // selection — empty string for "Combined") always wins over the persisted default, so filtering never
    // depends on the persisted value having been re-read, or on the panel having been closed and reopened
    // to pick up a change made somewhere else (Settings page, another window). undefined (no param at all,
    // any other caller of this route) falls back to the persisted value. The persisted value is updated
    // here too, purely so the NEXT cold open of the tray restores the last selection.
    const explicit = req.query.provider !== undefined;
    const filterProvider = explicit ? req.query.provider || null : loadTrayFilterProvider();
    if (explicit) saveTrayFilterProvider(filterProvider);

    const perFolder = await Promise.all(
      folders
        .filter((folder) => folder.remotePrefix !== '*') // read-only whole-account views are noisy, skip for "recent"
        .filter((folder) => !folder.remoteFolderId) // pinned real folders need browseFolder, not list() — skip here, they still show fine from Cloud Services/Pinned Folders directly
        .filter((folder) => !filterProvider || folder.provider === filterProvider) // tray's own Recent Cloud Files provider dropdown
        .map(async (folder) => {
          const backend = backends.get(folder.provider);
          if (!backend) return [];
          try {
            const files = await backend.list(folder.remotePrefix);
            // thumbnailUrl was dropped here even though backend.list() (Drive, at least) already returns
            // it on every FileEntry — every other view (Files, Cloud Services, Overview) passes it through
            // to <Thumbnail>, only this route silently stripped it, forcing the tray to fall back to
            // downloading the WHOLE file client-side just to render a small preview.
            return files.map((f) => ({ folderId: folder.id, folderName: folder.name, provider: folder.provider, path: f.path, size: f.size, modifiedAt: f.modifiedAt, thumbnailUrl: f.thumbnailUrl }));
          } catch {
            return [];
          }
        }),
    );

    let entries = perFolder.flat();

    // A specific account picked in the tray dropdown but with no tracked, populated pinned folder (most
    // multi-account Drive setups: only "Drive"/"All Files" tracked, one empty, one deliberately skipped
    // above) used to just show "Nothing synced yet" even when the account genuinely has files sitting in
    // it — confirmed live: real files existed in the account's own AllieMinate folder, just not under any
    // remotePrefix this app happens to have a folder config for. Falls back to a real whole-account scan,
    // the same one the "All Files" pseudo-folder itself uses, only when the folder-based scan came up
    // empty — an account WITH a populated tracked folder still just shows that, not its entire Drive.
    if (filterProvider && entries.length === 0) {
      const backend = backends.get(filterProvider);
      if (backend?.listAll) {
        try {
          const files = withoutTrash(await backend.listAll());
          entries = files.map((f) => ({ folderId: '', folderName: '', provider: filterProvider, providerId: filterProvider, path: f.path, size: f.size, modifiedAt: f.modifiedAt, thumbnailUrl: f.thumbnailUrl }));
        } catch {
          // leave entries empty — account unreachable is a real "nothing to show," not silently ignorable
        }
      }
    }

    entries.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    return { files: entries.slice(0, limit) };
  });

  // "This Mac" in the tray's Recent Devices Files tab — the Mac's own recently-touched local files,
  // same idea as a paired phone's recent-files strip but reading straight off this machine's disk
  // instead of over the LAN.
  app.get<{ Querystring: { limit?: string } }>('/local/recent', async (req) => {
    const limit = Math.min(50, Number(req.query.limit ?? 10) || 10);
    return { files: listLocalRecentFiles(limit) };
  });

  app.get<{ Querystring: { path?: string } }>('/local/download', async (req, reply) => {
    const filePath = req.query.path;
    if (!filePath) return reply.code(400).send({ error: 'missing ?path=' });
    if (!isAllowedLocalPath(filePath)) return reply.code(403).send({ error: 'path not allowed' });
    try {
      const data = await fs.promises.readFile(filePath);
      reply.header('Content-Type', 'application/octet-stream');
      return reply.send(data);
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.get<{ Params: { id: string } }>('/folders/:id/files', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });

    const backend = backends.get(folder.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    if (folder.remoteFolderId) {
      if (!backend.browseFolder) return reply.code(409).send({ error: 'folder browsing not supported for this provider' });
      const { files } = await backend.browseFolder(folder.remoteFolderId);
      return { files: withoutTrash(files) };
    }

    if (folder.remotePrefix === '*') {
      if (!backend.listAll) return reply.code(409).send({ error: 'whole-account listing not supported for this provider' });
      return { files: withoutTrash(await backend.listAll()) };
    }

    return { files: await backend.list(folder.remotePrefix) };
  });

  // a paired peer browsing this device's cloud folders (RemoteBrowser) proxies delete/rename here — this
  // device's OWN UI instead goes through /files/trash and /files/rename, which is why these two never
  // existed before: the receiving side of that proxy was simply never built, so a peer's delete/rename
  // request 404'd. Reuses the exact same trash-on-delete / get+put+delete-on-rename logic those routes do.
  app.delete<{ Params: { id: string }; Querystring: { key: string } }>('/folders/:id/file', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const backend = backends.get(folder.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const entries = loadTrash();
    entries.push(await trashOne(backend, folder.provider, folder.id, req.query.key));
    saveTrash(entries);

    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: req.query.key, deleted: true } });
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Querystring: { key: string; newName: string } }>('/folders/:id/file', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const backend = backends.get(folder.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const { key, newName } = req.query;
    if (!newName || newName.includes('/')) return reply.code(400).send({ error: 'invalid name' });

    const newKey = path.posix.join(path.posix.dirname(key), newName);
    const data = await backend.get(key);
    await backend.put(newKey, data);
    await backend.delete(key);

    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: newKey, renamedFrom: key } });
    return { ok: true, key: newKey };
  });

  async function filesOf(folder: FolderConfig, backend: StorageBackend) {
    if (folder.remoteFolderId) return backend.browseFolder ? withoutTrash((await backend.browseFolder(folder.remoteFolderId)).files) : [];
    if (folder.remotePrefix === '*') return backend.listAll ? withoutTrash(await backend.listAll()) : [];
    return backend.list(folder.remotePrefix);
  }

  app.patch<{ Params: { id: string }; Body: { name?: string; pinned?: boolean } }>(
    '/folders/:id',
    async (req, reply) => {
      const folder = folders.find((f) => f.id === req.params.id);
      if (!folder) return reply.code(404).send({ error: 'folder not found' });

      if (typeof req.body.name === 'string' && req.body.name.trim()) folder.name = req.body.name.trim();
      if (typeof req.body.pinned === 'boolean') folder.pinned = req.body.pinned;
      saveFolders(folders);
      return { id: folder.id, name: folder.name, pinned: folder.pinned !== false };
    },
  );

  app.get<{ Params: { id: string } }>('/folders/:id/details', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const backend = backends.get(folder.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const files = await filesOf(folder, backend);
    const byCategory: Record<string, number> = {};
    let totalBytes = 0;
    let earliest: string | null = null;
    for (const f of files) {
      totalBytes += f.size;
      const ext = f.path.split('.').pop()?.toLowerCase() ?? 'other';
      byCategory[ext] = (byCategory[ext] ?? 0) + 1;
      const created = f.createdAt ?? f.modifiedAt;
      if (!earliest || created < earliest) earliest = created;
    }

    return {
      name: folder.name,
      provider: folder.provider,
      fileCount: files.length,
      totalBytes,
      byExtension: byCategory,
      earliestFileAt: earliest,
    };
  });

  // duplicates every file under this folder's prefix into a sibling prefix, plus a matching pinned-folder
  // entry — not available for "*" whole-account views (there's no single prefix to copy).
  app.post<{ Params: { id: string } }>('/folders/:id/duplicate', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    if (folder.remotePrefix === '*') return reply.code(400).send({ error: "can't duplicate a whole-account view" });
    if (folder.remoteFolderId) return reply.code(400).send({ error: "can't duplicate a pinned real folder" });

    const backend = backends.get(folder.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const files = await backend.list(folder.remotePrefix);
    const newPrefix = `${folder.remotePrefix}-copy-${Date.now()}`;
    for (const f of files) {
      const data = await backend.get(f.path);
      const destKey = path.posix.join(newPrefix, path.posix.relative(folder.remotePrefix, f.path));
      await backend.put(destKey, data);
    }

    const newFolder: FolderConfig = {
      id: crypto.randomUUID(),
      name: `${folder.name} (Copy)`,
      localPath: '',
      provider: folder.provider,
      remotePrefix: newPrefix,
      pinned: folder.pinned,
    };
    folders.push(newFolder);
    saveFolders(folders);
    return { folder: newFolder };
  });

  app.get<{ Params: { id: string } }>('/folders/:id/zip', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const backend = backends.get(folder.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const files = await filesOf(folder, backend);
    const zip = new JSZip();
    for (const f of files) {
      const data = await backend.get(f.path);
      zip.file(path.posix.basename(f.path), data);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${folder.name.replace(/[^\w.-]+/g, '_')}.zip"`);
    return reply.send(buf);
  });

  app.get<{ Querystring: { folderId?: string; providerId?: string; key: string } }>('/files/details', async (req, reply) => {
    const folder = req.query.folderId ? folders.find((f) => f.id === req.query.folderId) : undefined;
    const provider = folder?.provider ?? req.query.providerId;
    if (!provider) return reply.code(404).send({ error: 'folder or provider not found' });
    const backend = backends.get(provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const files = folder ? await filesOf(folder, backend) : backend.listAll ? await backend.listAll() : await backend.list('');
    const entry = files.find((f) => f.path === req.query.key);
    if (!entry) return reply.code(404).send({ error: 'file not found' });

    const driveAccounts = loadDriveAccounts();
    const accountLabel = driveAccounts.find((a) => a.accountId === provider)?.label;

    return {
      name: path.posix.basename(entry.path),
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      createdAt: entry.createdAt ?? null,
      provider,
      providerLabel: accountLabel ?? baseProviderOf(provider),
      folderName: folder?.name ?? baseProviderOf(provider),
    };
  });

  app.post<{ Params: { id: string }; Querystring: { name: string } }>(
    '/folders/:id/upload',
    async (req, reply) => {
      const folder = folders.find((f) => f.id === req.params.id);
      if (!folder) return reply.code(404).send({ error: 'folder not found' });

      const backend = backends.get(folder.provider);
      if (!backend) return reply.code(409).send({ error: 'provider not configured' });

      const name = req.query.name;
      if (!name) return reply.code(400).send({ error: 'missing ?name=' });

      const data = req.body as Buffer;

      if (folder.remoteFolderId) {
        if (!backend.putInFolder) return reply.code(409).send({ error: 'uploading into a real folder not supported for this provider' });
        await backend.putInFolder(folder.remoteFolderId, name, data);
        emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: name, size: data.length } });
        return { ok: true, key: name, size: data.length };
      }

      const key = path.posix.join(folder.remotePrefix, name);
      await backend.put(key, data);
      emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key, size: data.length } });

      return { ok: true, key, size: data.length };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { key: string } }>(
    '/folders/:id/download',
    async (req, reply) => {
      const folder = folders.find((f) => f.id === req.params.id);
      if (!folder) return reply.code(404).send({ error: 'folder not found' });

      const backend = backends.get(folder.provider);
      if (!backend) return reply.code(409).send({ error: 'provider not configured' });

      const key = req.query.key;
      if (!key) return reply.code(400).send({ error: 'missing ?key=' });

      const data = await backend.get(key);
      reply.header('Content-Type', 'application/octet-stream');
      return reply.send(data);
    },
  );

  // resolves either a real pinned folder (files land under its remotePrefix) or a bare provider/account
  // (files land at root — no prefix) — lets every mutating file route work the same way whether it was
  // triggered from a Files/Pinned-Folder view or from the raw Cloud Services provider browse.
  function resolveTarget(folderId?: string, providerId?: string): { backend: StorageBackend; prefix: string; folderRef: string; remoteFolderId?: string } | null {
    if (folderId) {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder || folder.remotePrefix === '*') return null;
      const backend = backends.get(folder.provider);
      if (!backend) return null;
      return { backend, prefix: folder.remotePrefix, folderRef: folder.id, remoteFolderId: folder.remoteFolderId };
    }
    if (providerId) {
      const backend = backends.get(providerId);
      if (!backend) return null;
      return { backend, prefix: '', folderRef: providerId };
    }
    return null;
  }

  app.post<{ Body: { folderId?: string; providerId?: string; key: string; newName: string } }>(
    '/files/rename',
    async (req, reply) => {
      const { folderId, providerId, key, newName } = req.body;
      if (!newName || newName.includes('/')) return reply.code(400).send({ error: 'invalid name' });
      const target = resolveTarget(folderId, providerId);
      if (!target) return reply.code(404).send({ error: 'folder or provider not found' });

      const newKey = path.posix.join(path.posix.dirname(key), newName);
      const data = await target.backend.get(key);
      await target.backend.put(newKey, data);
      await target.backend.delete(key);

      emitSyncEvent({ type: 'file-synced', folderId: target.folderRef, payload: { key: newKey, renamedFrom: key } });
      return { ok: true, key: newKey };
    },
  );

  app.post<{ Body: { sourceFolderId?: string; sourceProviderId?: string; key: string; destFolderId?: string; destProviderId?: string; destName?: string } }>(
    '/files/move',
    async (req, reply) => {
      const { sourceFolderId, sourceProviderId, key, destFolderId, destProviderId, destName: destNameRaw } = req.body;
      const source = resolveTarget(sourceFolderId, sourceProviderId);
      const dest = resolveTarget(destFolderId, destProviderId);
      if (!source || !dest) return reply.code(404).send({ error: 'folder or provider not found' });

      const destName = destNameRaw || path.posix.basename(key);
      const data = await source.backend.get(key);
      let destKey: string;
      if (dest.remoteFolderId) {
        if (!dest.backend.putInFolder) return reply.code(409).send({ error: 'moving into a real folder not supported for this provider' });
        await dest.backend.putInFolder(dest.remoteFolderId, destName, data);
        destKey = destName;
      } else {
        destKey = path.posix.join(dest.prefix, destName);
        await dest.backend.put(destKey, data);
      }
      await source.backend.delete(key);

      emitSyncEvent({ type: 'file-synced', folderId: dest.folderRef, payload: { key: destKey, size: data.length } });
      emitSyncEvent({ type: 'file-synced', folderId: source.folderRef, payload: { key, deleted: true } });
      return { ok: true, key: destKey };
    },
  );

  app.post<{ Body: { sourceFolderId?: string; sourceProviderId?: string; key: string; destFolderId?: string; destProviderId?: string; destName?: string } }>(
    '/files/copy',
    async (req, reply) => {
      const { sourceFolderId, sourceProviderId, key, destFolderId, destProviderId, destName: destNameRaw } = req.body;
      const source = resolveTarget(sourceFolderId, sourceProviderId);
      const dest = resolveTarget(destFolderId, destProviderId);
      if (!source || !dest) return reply.code(404).send({ error: 'folder or provider not found' });

      const destName = destNameRaw || path.posix.basename(key);
      const data = await source.backend.get(key);
      let destKey: string;
      if (dest.remoteFolderId) {
        if (!dest.backend.putInFolder) return reply.code(409).send({ error: 'copying into a real folder not supported for this provider' });
        await dest.backend.putInFolder(dest.remoteFolderId, destName, data);
        destKey = destName;
      } else {
        destKey = path.posix.join(dest.prefix, destName);
        await dest.backend.put(destKey, data);
      }

      emitSyncEvent({ type: 'file-synced', folderId: dest.folderRef, payload: { key: destKey, size: data.length } });
      return { ok: true, key: destKey };
    },
  );

  // shared by /files/trash and /files/trash-many — moves one file to trash and appends its entry. Caller
  // is responsible for loading/saving the trash list (batched callers save once at the end, not per file).
  async function trashOne(backend: StorageBackend, provider: string, folderId: string | undefined, key: string) {
    const data = await backend.get(key);
    const id = crypto.randomUUID();
    const trashKey = `_trash/${id}__${path.posix.basename(key)}`;
    await backend.put(trashKey, data);
    await backend.delete(key);
    return {
      id,
      name: path.posix.basename(key),
      size: data.length,
      provider,
      originalFolderId: folderId ?? provider,
      originalKey: key,
      trashKey,
      deletedAt: new Date().toISOString(),
    };
  }

  app.post<{ Body: { folderId?: string; providerId?: string; key: string } }>('/files/trash', async (req, reply) => {
    const { folderId, providerId, key } = req.body;
    // unlike copy/move (which need a real prefix to write a destination into), delete works fine from a
    // whole-account "*" listing or a raw provider browse — backend.get/delete resolve the key by name
    // regardless of folder scope.
    const provider = folderId ? folders.find((f) => f.id === folderId)?.provider : providerId;
    if (!provider) return reply.code(404).send({ error: 'folder or provider not found' });

    const backend = backends.get(provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const entries = loadTrash();
    entries.push(await trashOne(backend, provider, folderId, key));
    saveTrash(entries);

    emitSyncEvent({ type: 'file-synced', folderId: folderId ?? provider, payload: { key, deleted: true } });
    return { ok: true };
  });

  // Bulk trash by name — used when a paired device deletes a Sync Pair and wants its already-synced files
  // cleaned up too, instead of leaving hundreds of orphaned files behind that a "delete the backup" click
  // gave no indication would survive. Bounded concurrency for the same reason /trash/empty needed it: a
  // sequential loop over a whole camera roll's worth of files is what made trash operations feel hung.
  app.post<{ Body: { folderId?: string; providerId?: string; keys: string[] } }>('/files/trash-many', async (req, reply) => {
    const { folderId, providerId, keys } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) return reply.code(400).send({ error: 'missing keys' });

    const provider = folderId ? folders.find((f) => f.id === folderId)?.provider : providerId;
    if (!provider) return reply.code(404).send({ error: 'folder or provider not found' });

    const backend = backends.get(provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const entries = loadTrash();
    let trashedCount = 0;
    await deleteAllConcurrently(keys, async (key) => {
      entries.push(await trashOne(backend, provider, folderId, key));
      trashedCount++;
    });
    saveTrash(entries);

    emitSyncEvent({ type: 'file-synced', folderId: folderId ?? provider, payload: { keys, deleted: true } });
    return { ok: true, trashed: trashedCount, requested: keys.length };
  });

  app.get('/trash', async () => {
    let entries = loadTrash();
    const cutoff = Date.now() - TRASH_MAX_AGE_MS;
    const expired = entries.filter((e) => new Date(e.deletedAt).getTime() < cutoff);

    // a failed delete (rate limit, transient network blip) used to get pruned from trash.json anyway —
    // the entry vanished from AllieMinate's own Trash view with no way to ever retry it, while the actual
    // file stayed sitting on the provider under its confusing "_trash/<uuid>__name" name forever. Keep
    // failed entries around so the next sweep (or a manual Empty Trash) gets another shot at them.
    const failedIds = new Set((await deleteAllConcurrently(expired, async (e) => {
      const backend = backends.get(e.provider);
      if (backend) await backend.delete(e.trashKey);
    })).map((e) => e.id));
    const actuallyExpired = expired.filter((e) => !failedIds.has(e.id));
    if (actuallyExpired.length) {
      entries = entries.filter((e) => !actuallyExpired.some((x) => x.id === e.id));
      saveTrash(entries);
    }

    return { entries };
  });

  // inline preview only — Trash items are deliberately not openable in an external app (they're on their
  // way out), just viewable to confirm what they are before Restore/Delete Forever.
  app.get<{ Params: { id: string } }>('/trash/:id/download', async (req, reply) => {
    const entry = loadTrash().find((e) => e.id === req.params.id);
    if (!entry) return reply.code(404).send({ error: 'trash entry not found' });

    const backend = backends.get(entry.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const data = await backend.get(entry.trashKey);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(data);
  });

  app.post<{ Params: { id: string } }>('/trash/:id/restore', async (req, reply) => {
    const entries = loadTrash();
    const entry = entries.find((e) => e.id === req.params.id);
    if (!entry) return reply.code(404).send({ error: 'trash entry not found' });

    const backend = backends.get(entry.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not configured' });

    const data = await backend.get(entry.trashKey);
    await backend.put(entry.originalKey, data);
    await backend.delete(entry.trashKey);

    saveTrash(entries.filter((e) => e.id !== entry.id));
    emitSyncEvent({
      type: 'file-synced',
      folderId: entry.originalFolderId,
      payload: { key: entry.originalKey, size: data.length },
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/trash/:id', async (req, reply) => {
    const entries = loadTrash();
    const entry = entries.find((e) => e.id === req.params.id);
    if (!entry) return reply.code(404).send({ error: 'trash entry not found' });

    const backend = backends.get(entry.provider);
    if (backend) await backend.delete(entry.trashKey);

    saveTrash(entries.filter((e) => e.id !== entry.id));
    return { ok: true };
  });

  app.post('/trash/empty', async () => {
    const entries = loadTrash();
    // same "don't lose the record of a file whose delete actually failed" reasoning as the /trash expiry
    // sweep above — an "Empty Trash" that silently wipes trash.json even when some deletes errored out
    // orphans those files on the provider with no trace of them left in AllieMinate at all.
    const failed = await deleteAllConcurrently(entries, async (entry) => {
      const backend = backends.get(entry.provider);
      if (backend) await backend.delete(entry.trashKey);
    });
    saveTrash(failed);
    return { ok: true, cleared: entries.length - failed.length, failed: failed.length };
  });

  app.get('/storage', async () => {
    const driveAccounts = loadDriveAccounts();
    const labelFor = (accountId: string) => driveAccounts.find((a) => a.accountId === accountId)?.label;

    // Promise.all already runs every provider's usage lookup CONCURRENTLY — the actual bottleneck was
    // that the whole /storage RESPONSE waited for the slowest one to settle (a cold MEGA login taking its
    // full 15s timeout blocked every other, already-fast provider's numbers from reaching the UI at all).
    // Serve the last cached value immediately (even if stale) and refresh in the background — a
    // 'storage-updated' sync event over the same WebSocket the app already listens on tells the renderer
    // to refetch once a slow provider actually finishes, so the number still shows up without a manual
    // reload. Only a provider that has NEVER been fetched even once has to be awaited inline here, since
    // there's nothing to serve yet.
    const providers = (
      await Promise.all(
        Array.from(backends.entries()).map(async ([accountId, backend]) => {
          const cached = storageCache.get(accountId);
          if (cached) {
            refreshProviderStorage(accountId, backend, labelFor); // fire-and-forget, updates cache + emits when done
            return cached;
          }
          return refreshProviderStorage(accountId, backend, labelFor);
        }),
      )
    ).filter((p): p is NonNullable<typeof p> => p !== null);
    return { providers };
  });

  // extra linked Google Drive accounts, plus the primary one (configured via .env, so it has no entry in
  // driveAccounts.json — without this it fell back to the generic "Google Drive" label everywhere instead
  // of its real email, unlike every other linked account).
  let primaryDriveLabel: string | undefined; // retried until it succeeds once, then cached
  let primaryDriveLabelFailedAt: number | undefined;
  // a REVOKED refresh token (invalid_grant — the user re-authorized elsewhere, or Google expired it) can
  // never succeed, but this route used to retry it on literally every single /accounts call forever, each
  // attempt logging a multi-hundred-line gaxios error object — the exact same "never cache a failure"
  // shape that made B2's transaction-cap error hammer the app earlier. Same fix: back off after a failure
  // instead of re-attempting every call.
  const PRIMARY_DRIVE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
  app.get('/accounts', async () => {
    const accounts = loadDriveAccounts().map((a) => ({ accountId: a.accountId, label: a.label, provider: 'google-drive' }));

    const primaryDriveBackend = backends.get('google-drive');
    const inCooldown = primaryDriveLabelFailedAt && Date.now() - primaryDriveLabelFailedAt < PRIMARY_DRIVE_FAILURE_COOLDOWN_MS;
    if (config.googleDrive && primaryDriveBackend?.getAccountEmail && !inCooldown) {
      if (!primaryDriveLabel) {
        // the primary account's refresh token predates account labels and was only ever consented with
        // Drive scope, not userinfo.email — any oauth2/userinfo call 401s no matter how it's made.
        // Drive's own about.get already returns the account owner's email and needs no extra scope.
        try {
          primaryDriveLabel = (await primaryDriveBackend.getAccountEmail()) ?? undefined;
          primaryDriveLabelFailedAt = undefined;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`primary Drive account email lookup failed: ${message}`);
          primaryDriveLabelFailedAt = Date.now();
        }
      }
      if (primaryDriveLabel) accounts.push({ accountId: 'google-drive', label: primaryDriveLabel, provider: 'google-drive' });
    }

    return { accounts };
  });

  app.delete<{ Params: { id: string } }>('/accounts/:id', async (req, reply) => {
    const accounts = loadDriveAccounts();
    if (!accounts.some((a) => a.accountId === req.params.id)) {
      return reply.code(404).send({ error: 'account not found' });
    }
    saveDriveAccounts(accounts.filter((a) => a.accountId !== req.params.id));
    backends.delete(req.params.id);

    const remainingFolders = folders.filter((f) => f.provider !== req.params.id);
    if (remainingFolders.length !== folders.length) {
      folders.length = 0;
      folders.push(...remainingFolders);
      saveFolders(folders);
    }
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { label: string } }>('/accounts/:id', async (req, reply) => {
    const label = req.body?.label?.trim();
    if (!label) return reply.code(400).send({ error: 'missing label' });

    const accounts = loadDriveAccounts();
    const account = accounts.find((a) => a.accountId === req.params.id);
    if (!account) return reply.code(404).send({ error: 'account not found' });

    const oldFolderName = `${account.label} (Drive)`;
    account.label = label;
    saveDriveAccounts(accounts);

    // keep the account's auto-created folder name in sync, if it hasn't been renamed to something else.
    const folder = folders.find((f) => f.provider === req.params.id && f.name === oldFolderName);
    if (folder) {
      folder.name = `${label} (Drive)`;
      saveFolders(folders);
    }

    return { ok: true };
  });

  // whole-account browse for the Cloud Services view — every connected provider, not just synced folders.
  app.get<{ Params: { id: string } }>('/providers/:id/browse', async (req, reply) => {
    const backend = backends.get(req.params.id);
    if (!backend) return reply.code(404).send({ error: 'provider not connected' });

    const files = backend.listAll ? await backend.listAll() : await backend.list('');
    return { files: withoutTrash(files) };
  });

  app.get<{ Params: { id: string }; Querystring: { key: string } }>('/providers/:id/download', async (req, reply) => {
    const backend = backends.get(req.params.id);
    if (!backend) return reply.code(404).send({ error: 'provider not connected' });

    const data = await backend.get(req.query.key);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(data);
  });

  // Finder-style upload destination picker — browse the account's REAL folder tree (not AllieMinate's
  // managed prefix), one level at a time. folderId omitted/empty means the account's top level.
  app.get<{ Params: { id: string }; Querystring: { folderId?: string } }>('/providers/:id/tree', async (req, reply) => {
    const backend = backends.get(req.params.id);
    if (!backend) return reply.code(404).send({ error: 'provider not connected' });
    if (!backend.browseFolder) return reply.code(409).send({ error: 'folder browsing not supported for this provider' });

    const { folders, files } = await backend.browseFolder(req.query.folderId || null);
    return { folders, files: withoutTrash(files) };
  });

  app.post<{ Params: { id: string }; Body: { parentId?: string; name: string } }>(
    '/providers/:id/folders',
    async (req, reply) => {
      const backend = backends.get(req.params.id);
      if (!backend) return reply.code(404).send({ error: 'provider not connected' });
      if (!backend.makeFolder) return reply.code(409).send({ error: 'folder creation not supported for this provider' });

      const name = req.body.name?.trim();
      if (!name) return reply.code(400).send({ error: 'missing folder name' });

      const folder = await backend.makeFolder(req.body.parentId || null, name);
      return { folder };
    },
  );

  // scoped registration so this route's octet-stream body arrives as a raw, unbuffered stream (payload
  // straight off the socket) instead of the app-wide parser's fully-materialized Buffer — Fastify's
  // content-type parsers are encapsulated per-plugin-scope, so this override doesn't leak to any other
  // route. A multi-GB phone-to-cloud share can then pipe straight through to a provider that supports
  // streaming uploads (Drive) without ever sitting fully in Node memory first, which is what made very
  // large transfers slow enough to risk an idle-connection drop somewhere along the way.
  await app.register(async (scoped) => {
    // a child scope can't just addContentTypeParser over a parent's existing one for the same content
    // type — Fastify throws FST_ERR_CTP_ALREADY_PRESENT. Remove the inherited buffer-mode parser first,
    // scoped to this plugin only (removeContentTypeParser is itself encapsulated, same as add).
    scoped.removeContentTypeParser('application/octet-stream');
    scoped.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
      done(null, payload);
    });

    scoped.post<{ Params: { id: string }; Querystring: { name: string; folderId?: string } }>(
      '/providers/:id/upload',
      async (req, reply) => {
        const backend = backends.get(req.params.id);
        if (!backend) return reply.code(404).send({ error: 'provider not connected' });

        const name = req.query.name;
        if (!name) return reply.code(400).send({ error: 'missing ?name=' });

        const stream = req.body as Readable;
        if (backend.putStreamInFolder) {
          await backend.putStreamInFolder(req.query.folderId || null, name, stream);
          return { ok: true };
        }
        if (!backend.putInFolder) return reply.code(409).send({ error: 'targeted upload not supported for this provider' });
        const data = await streamToBuffer(stream);
        await backend.putInFolder(req.query.folderId || null, name, data);
        return { ok: true, size: data.length };
      },
    );
  });

  // "Send to Connected Devices" from a phone's share-sheet — lands straight in this Mac's own Downloads
  // folder rather than any AllieMinate-managed cloud folder, mirroring what a direct device-to-device
  // AirDrop-style transfer means (as opposed to "Save File to Cloud", which is the /folders/:id/upload
  // path). Reuses the existing 'file-synced' sync-event so the tray/activity feed and OS notification
  // fire the same way a normal sync does.
  app.post<{ Querystring: { name: string; from?: string } }>('/inbox/upload', async (req, reply) => {
    const { name, from } = req.query;
    if (!name) return reply.code(400).send({ error: 'missing ?name=' });

    const receiveDir = loadReceivePath();
    await fs.promises.mkdir(receiveDir, { recursive: true });
    const safeName = path.basename(name);
    const destPath = path.join(receiveDir, safeName);
    const data = req.body as Buffer;
    await fs.promises.writeFile(destPath, data);

    const authToken = req.headers.authorization?.replace('Bearer ', '');
    const sender = authToken ? findByToken(authToken) : undefined;
    logTransfer({
      deviceId: sender?.id ?? 'unknown',
      deviceName: sender?.name ?? from ?? 'Unknown device',
      fileName: safeName,
      direction: 'received',
      size: data.length,
      path: destPath,
    });

    emitSyncEvent({ type: 'file-synced', folderId: 'device-inbox', payload: { key: safeName, size: data.length, from } });
    return { ok: true, path: destPath };
  });

  // --- Nearby Share: unpaired, LAN-discovered devices — accept/decline consent per transfer instead of
  // the persistent trust a real pairing grants. Receiver-side routes (request/status/respond/upload) are
  // unauthenticated (see PUBLIC_LAN_PREFIXES) since a sender that only just discovered this device via UDP
  // broadcast has no token for it; /nearby/send below is the sender side, called by THIS app's own UI. ---

  app.post<{ Body: { fromId: string; fromName: string; fileName: string; fileSize: number } }>('/nearby/request', async (req, reply) => {
    const { fromId, fromName, fileName, fileSize } = req.body ?? {};
    if (!fromId || !fromName || !fileName) return reply.code(400).send({ error: 'missing fromId, fromName, or fileName' });
    const request = createNearbyRequest(fromId, fromName, fileName, fileSize ?? 0);
    // if the app window is open, this is what pops the accept/decline prompt — same "something happened,
    // go react" WebSocket channel every other real-time notice already rides.
    emitSyncEvent({ type: 'nearby-request', folderId: request.id, payload: { id: request.id, fromName, fileName, fileSize } });
    return { ok: true, requestId: request.id };
  });

  app.get<{ Params: { id: string } }>('/nearby/request/:id/status', async (req, reply) => {
    const request = getNearbyRequest(req.params.id);
    if (!request) return reply.code(404).send({ error: 'request not found' });
    return { status: request.status };
  });

  app.post<{ Params: { id: string }; Body: { accept: boolean } }>('/nearby/request/:id/respond', async (req, reply) => {
    const request = respondToNearbyRequest(req.params.id, req.body?.accept === true);
    if (!request) return reply.code(409).send({ error: 'request not pending or not found' });
    return { ok: true, status: request.status };
  });

  app.post<{ Params: { id: string } }>('/nearby/request/:id/upload', async (req, reply) => {
    const request = getNearbyRequest(req.params.id);
    if (!request || request.status !== 'accepted') return reply.code(403).send({ error: 'transfer not accepted' });

    const receiveDir = loadReceivePath();
    await fs.promises.mkdir(receiveDir, { recursive: true });
    const safeName = path.basename(request.fileName);
    const destPath = path.join(receiveDir, safeName);
    const data = req.body as Buffer;
    await fs.promises.writeFile(destPath, data);

    logTransfer({
      deviceId: request.fromId,
      deviceName: request.fromName,
      fileName: safeName,
      direction: 'received',
      size: data.length,
      path: destPath,
    });

    emitSyncEvent({ type: 'file-synced', folderId: 'nearby-share', payload: { key: safeName, size: data.length, from: request.fromName } });
    return { ok: true, path: destPath };
  });

  // Phase 3: Phone as Remote Unlock/Approve — receiver side, for whenever THIS device (desktop or, in
  // principle, another Mac/PC) is the one being asked to approve an unlock. Unlike /nearby/request, this
  // is NOT in PUBLIC_LAN_PREFIXES — a Bearer token from an already-paired device is required, since
  // approving someone else's unlock is a much higher-stakes action than accepting a file. Only the sender
  // side (devices.ts's /unlock/broadcast + /unlock/status) reaches out here; nothing about this route
  // grants access to the OS's own login/lock screen, only to AllieMinate's in-app App Lock.
  app.post<{ Body: { requestId: string; fromName: string } }>('/unlock/request', async (req, reply) => {
    const { requestId, fromName } = req.body ?? {};
    if (!requestId || !fromName) return reply.code(400).send({ error: 'missing requestId or fromName' });
    const request = createUnlockRequest(requestId, fromName);
    emitSyncEvent({ type: 'unlock-request', folderId: request.id, payload: { id: request.id, fromName } });
    return { ok: true, requestId: request.id };
  });

  app.get<{ Params: { id: string } }>('/unlock/request/:id/status', async (req, reply) => {
    const request = getUnlockRequest(req.params.id);
    if (!request) return reply.code(404).send({ error: 'request not found' });
    return { status: request.status };
  });

  app.post<{ Params: { id: string }; Body: { accept: boolean } }>('/unlock/request/:id/respond', async (req, reply) => {
    const request = respondToUnlockRequest(req.params.id, req.body?.accept === true);
    if (!request) return reply.code(409).send({ error: 'request not pending or not found' });
    return { ok: true, status: request.status };
  });

  app.post<{ Querystring: { peerId: string; name: string } }>('/nearby/send', async (req, reply) => {
    const { peerId, name } = req.query;
    if (!peerId || !name) return reply.code(400).send({ error: 'missing peerId or name' });
    const peer = getNearbyPeers().find((p) => p.id === peerId);
    if (!peer) return reply.code(404).send({ error: 'that device is no longer nearby' });

    const result = await sendBytesToNearbyPeer(peer, name, req.body as Buffer);
    if (!result.ok && result.status === 'unreachable') return reply.code(502).send({ error: result.error ?? 'device unreachable' });
    return result;
  });

  app.get('/transfers', async () => ({ transfers: loadTransferHistory() }));

  app.delete<{ Params: { id: string } }>('/transfers/:id', async (req) => {
    removeTransferEntry(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { name: string } }>('/transfers/:id/rename', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'missing name' });
    const result = renameTransferFile(req.params.id, name);
    if (!result.ok) return reply.code(400).send(result);
    return result;
  });

  app.get<{ Params: { id: string } }>('/transfers/:id', async (req, reply) => {
    const entry = findTransferEntry(req.params.id);
    if (!entry) return reply.code(404).send({ error: 'not found' });
    return entry;
  });

  app.get('/ws', { websocket: true }, (socket) => {
    // A `ws` socket is an EventEmitter — if it emits 'error' with no listener attached (exactly what
    // happens when the network drops out from under an open connection mid-send, or the desktop app's
    // window closes without a clean WebSocket close handshake), Node throws it as an uncaught exception.
    // Without this handler, a Mac losing internet even briefly could take the whole backend process down
    // with it — the renderer's own reconnect logic already handles a dropped socket gracefully; the
    // backend just needs to not die when the write side of it breaks.
    socket.on('error', () => {});
    const onSyncEvent = (event: SyncEvent) => {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        // socket already dead — 'close' below will unsubscribe it from syncEvents shortly
      }
    };
    syncEvents.on('sync-event', onSyncEvent);
    socket.on('close', () => syncEvents.off('sync-event', onSyncEvent));
  });

  return app;
}
