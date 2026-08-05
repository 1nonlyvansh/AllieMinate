import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { isAllowedLocalPath } from '../localFiles';
import type { FolderConfig } from '@alliminate/shared';
import { PROVIDER_QUOTA_BYTES, baseProviderOf } from '@alliminate/shared';
import type { StorageBackend } from '../storage/StorageBackend';
import { getCachedPath, addToCache, getCacheStatus, saveCacheSettings, clearCache } from '../cache';
import { addRemoteCacheEntry, tempFileName } from '../remoteCache';
import { broadcastContinuity } from '../continuity';
import { loadPairedDevices } from '../pairing';
import { getDeviceIdentity } from '../device';
import { logTransfer } from '../transferHistory';
import { getNearbyPeers } from '../nearbyDiscovery';
import { sendBytesToNearbyPeer } from '../nearbyTransfer';
import {
  categoryForFile,
  extFromMime,
  getAvailableApps,
  loadOpenWithPrefs,
  saveOpenWithPref,
  OpenWithCategory,
} from '../openWith';

const CATEGORIES: OpenWithCategory[] = ['pdf', 'docx', 'spreadsheet', 'pptx', 'image', 'video', 'audio'];

/** Downloads a remote file into the local cache (or reuses an already-cached copy) and returns its real
 * absolute path on disk — shared by both /files/open (hands the path to `open`) and /files/cache-path
 * (hands the path to the OS pasteboard for "Copy to Clipboard", since a real file-url paste needs an
 * actual local file, not a remote URL). */
async function resolveCachedPath(backend: StorageBackend, providerKey: string, key: string, mimeType?: string): Promise<string> {
  const name = key.split('/').pop() ?? key;
  const cacheDisplayName = path.extname(name) ? name : `${name}${mimeType ? `.${extFromMime(mimeType) ?? 'bin'}` : ''}`;

  const cached = getCachedPath(providerKey, key);
  if (cached) return cached;

  const data = await backend.get(key);
  return addToCache(providerKey, key, data, cacheDisplayName);
}

export function registerLocalOpenRoutes(
  app: FastifyInstance,
  backends: Map<string, StorageBackend>,
  folders: FolderConfig[],
): void {
  app.get('/cache/status', async () => getCacheStatus());

  app.post<{ Body: { maxBytes: number } }>('/cache/settings', async (req, reply) => {
    const { maxBytes } = req.body;
    if (!maxBytes || maxBytes <= 0) return reply.code(400).send({ error: 'invalid maxBytes' });
    saveCacheSettings(maxBytes);
    return { ok: true };
  });

  app.post('/cache/clear', async () => {
    clearCache();
    return { ok: true };
  });

  app.get('/open-with', async () => {
    const prefs = loadOpenWithPrefs();
    const apps: Record<string, { name: string; path: string }[]> = {};
    for (const category of CATEGORIES) apps[category] = getAvailableApps(category);
    return { prefs, apps };
  });

  app.post<{ Body: { category: OpenWithCategory; appPath: string | null } }>('/open-with', async (req, reply) => {
    const { category, appPath } = req.body;
    if (!CATEGORIES.includes(category)) return reply.code(400).send({ error: 'unknown category' });
    saveOpenWithPref(category, appPath);
    return { ok: true };
  });

  app.post<{ Body: { folderId?: string; providerId?: string; key: string; mimeType?: string } }>(
    '/files/open',
    async (req, reply) => {
      const { folderId, providerId, key, mimeType } = req.body;
      if (!key || (!folderId && !providerId)) return reply.code(400).send({ error: 'missing folderId/providerId or key' });

      const backend = folderId
        ? backends.get(folders.find((f) => f.id === folderId)?.provider ?? '')
        : backends.get(providerId!);
      if (!backend) return reply.code(409).send({ error: 'provider not configured' });

      const name = key.split('/').pop() ?? key;
      const providerKey = folderId ?? providerId!;
      const filePath = await resolveCachedPath(backend, providerKey, key, mimeType);

      const category = categoryForFile(name, mimeType);
      const appPath = category ? loadOpenWithPrefs()[category] : undefined;

      const args = appPath ? ['-a', appPath, filePath] : [filePath];
      execFile('open', args, (err) => {
        if (err) app.log.error(err, 'failed to open file');
      });

      broadcastContinuity({ fileName: name, providerId: providerKey, key, mimeType });

      return { ok: true };
    },
  );

  // "Copy to Clipboard" for a remote cloud file — a real macOS pasteboard file-url paste needs an actual
  // local file, so this downloads/reuses the same on-disk cache /files/open uses, but hands the path back
  // to the renderer (which puts it on the pasteboard via file:copyLocal) instead of shelling out to `open`.
  app.post<{ Body: { folderId?: string; providerId?: string; key: string; mimeType?: string } }>(
    '/files/cache-path',
    async (req, reply) => {
      const { folderId, providerId, key, mimeType } = req.body;
      if (!key || (!folderId && !providerId)) return reply.code(400).send({ error: 'missing folderId/providerId or key' });

      const backend = folderId
        ? backends.get(folders.find((f) => f.id === folderId)?.provider ?? '')
        : backends.get(providerId!);
      if (!backend) return reply.code(409).send({ error: 'provider not configured' });

      const providerKey = folderId ?? providerId!;
      const filePath = await resolveCachedPath(backend, providerKey, key, mimeType);
      return { ok: true, path: filePath };
    },
  );

  // "Send to <Device>" — one click from any file menu app-wide, no folder picker: drops into the target
  // paired device's first folder (same convention the tray's drag-drop "Send to Device" flow already uses
  // for a phone, whose only writable target is its "Received on Phone" bucket).
  app.post<{ Body: { folderId?: string; providerId?: string; key?: string; localPath?: string; mimeType?: string; deviceId: string } }>(
    '/files/send-to-device',
    async (req, reply) => {
      const { folderId, providerId, key, localPath, mimeType, deviceId } = req.body;
      if (!deviceId) return reply.code(400).send({ error: 'missing deviceId' });
      if (!localPath && (!key || (!folderId && !providerId))) return reply.code(400).send({ error: 'missing folderId/providerId+key, or localPath' });
      if (localPath && !isAllowedLocalPath(localPath)) return reply.code(403).send({ error: 'path not allowed' });

      const backend = localPath ? null : folderId
        ? backends.get(folders.find((f) => f.id === folderId)?.provider ?? '')
        : backends.get(providerId!);
      if (!localPath && !backend) return reply.code(409).send({ error: 'provider not configured' });

      const peer = loadPairedDevices().find((d) => d.id === deviceId);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });

      const name = localPath ? path.basename(localPath) : (key!.split('/').pop() ?? key!);
      try {
        const data = localPath ? await fs.promises.readFile(localPath) : await backend!.get(key!);
        const statusRes = await fetch(`http://${peer.host}/status`, { headers: { Authorization: `Bearer ${peer.token}` } });
        if (!statusRes.ok) return reply.code(502).send({ error: 'device unreachable' });
        const statusData = await statusRes.json();
        const destFolderId = statusData.folders?.[0]?.id;
        if (!destFolderId) return reply.code(502).send({ error: "device has no folder to receive into" });

        const from = getDeviceIdentity().name;
        const uploadRes = await fetch(
          `http://${peer.host}/folders/${destFolderId}/upload?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${peer.token}` }, body: new Uint8Array(data) },
        );
        if (!uploadRes.ok) return reply.code(502).send({ error: 'device rejected the file' });
        logTransfer({ deviceId: peer.id, deviceName: peer.name, fileName: name, direction: 'sent', size: data.length, path: `${destFolderId}/${name}` });
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // "Share to Nearby" from any file menu — same accept/decline consent handshake as a direct nearby drop
  // (see nearbyTransfer.ts's sendBytesToNearbyPeer), just with the bytes fetched from a cloud provider
  // server-side first instead of already sitting on this device.
  app.post<{ Body: { folderId?: string; providerId?: string; key?: string; localPath?: string; mimeType?: string; peerId: string } }>(
    '/files/send-nearby',
    async (req, reply) => {
      const { folderId, providerId, key, localPath, peerId } = req.body;
      if (!peerId) return reply.code(400).send({ error: 'missing peerId' });
      if (!localPath && (!key || (!folderId && !providerId))) return reply.code(400).send({ error: 'missing folderId/providerId+key, or localPath' });
      if (localPath && !isAllowedLocalPath(localPath)) return reply.code(403).send({ error: 'path not allowed' });

      const backend = localPath ? null : folderId
        ? backends.get(folders.find((f) => f.id === folderId)?.provider ?? '')
        : backends.get(providerId!);
      if (!localPath && !backend) return reply.code(409).send({ error: 'provider not configured' });

      const peer = getNearbyPeers().find((p) => p.id === peerId);
      if (!peer) return reply.code(404).send({ error: 'that device is no longer nearby' });

      const name = localPath ? path.basename(localPath) : (key!.split('/').pop() ?? key!);
      try {
        const data = localPath ? await fs.promises.readFile(localPath) : await backend!.get(key!);
        const result = await sendBytesToNearbyPeer(peer, name, data);
        if (!result.ok && result.status === 'unreachable') return reply.code(502).send({ error: result.error ?? 'device unreachable' });
        return result;
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Body: { folderId?: string; providerId?: string; key: string; targetAccountId?: string } }>(
    '/files/open-online',
    async (req, reply) => {
      const { folderId, providerId, key, targetAccountId } = req.body;
      if (!key || (!folderId && !providerId)) return reply.code(400).send({ error: 'missing folderId/providerId or key' });

      const sourceProviderKey = folderId ? folders.find((f) => f.id === folderId)?.provider ?? '' : providerId!;
      const sourceBackend = backends.get(sourceProviderKey);
      if (!sourceBackend) return reply.code(409).send({ error: 'provider not configured' });

      // already lives in an account that can open it online — no upload needed at all.
      if (sourceBackend.getWebEditUrl) {
        const url = await sourceBackend.getWebEditUrl(key);
        if (url) return { ok: true, url };
      }

      const webCapable = Array.from(backends.entries()).filter(([, b]) => typeof b.getWebEditUrl === 'function');
      let target = targetAccountId;

      if (!target) {
        for (const [id, backend] of webCapable) {
          try {
            const files = await backend.list('');
            const used = files.reduce((sum, f) => sum + f.size, 0);
            const quota = PROVIDER_QUOTA_BYTES[baseProviderOf(id)] ?? Infinity;
            if (used / quota < 0.95) {
              target = id;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      const targetBackend = target ? backends.get(target) : undefined;
      if (!target || !targetBackend?.getWebEditUrl) {
        return reply.code(409).send({ error: 'no connected Google Drive or OneDrive account has room — link one, or free up space' });
      }

      const name = key.split('/').pop() ?? key;
      const tempKey = tempFileName(name);
      const data = await sourceBackend.get(key);
      await targetBackend.put(tempKey, data);
      addRemoteCacheEntry({ targetAccountId: target, tempKey, uploadedAt: Date.now() });

      const url = await targetBackend.getWebEditUrl(tempKey);
      if (!url) return reply.code(500).send({ error: "uploaded but couldn't get a web link back" });
      return { ok: true, url };
    },
  );
}
