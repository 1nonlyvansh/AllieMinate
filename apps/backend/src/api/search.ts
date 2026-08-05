import type { FastifyInstance } from 'fastify';
import { baseProviderOf } from '@alliminate/shared';
import type { StorageBackend } from '../storage/StorageBackend';
import { loadDriveAccounts } from '../accounts';
import { loadPairedDevices, PairedDevice } from '../pairing';
import { isOnline, fetchDeviceRecentFiles } from './devices';
import { withoutTrash } from '../trash';

const SEARCH_RESULT_CAP = 100;

export interface SearchResult {
  source: 'cloud' | 'device';
  sourceLabel: string;
  providerId?: string;
  deviceId?: string;
  folderId?: string;
  path: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

// Phase 4: Cross-Device Search — live fan-out across every connected cloud provider AND every currently
// online paired device's browsable categories, not a pre-built index. Simpler to reason about (no cache
// invalidation to get wrong) and every source this app already fans out to for /storage and /devices/recent
// is fast enough for this to stay responsive; if that stops being true for someone with many slow accounts,
// the fix is a cached index behind this same route, not a UI change.
export function registerSearchRoutes(app: FastifyInstance, backends: Map<string, StorageBackend>): void {
  app.get<{ Querystring: { q: string } }>('/search', async (req) => {
    const q = req.query.q?.trim().toLowerCase();
    if (!q) return { results: [] };

    const driveAccounts = loadDriveAccounts();
    const labelFor = (accountId: string) => driveAccounts.find((a) => a.accountId === accountId)?.label ?? baseProviderOf(accountId);

    const cloudResults = await Promise.all(
      Array.from(backends.entries()).map(async ([id, backend]): Promise<SearchResult[]> => {
        try {
          const files = withoutTrash(backend.listAll ? await backend.listAll() : await backend.list(''));
          return files
            .filter((f) => f.path.toLowerCase().includes(q))
            .map((f) => ({
              source: 'cloud' as const,
              sourceLabel: labelFor(id),
              providerId: id,
              path: f.path,
              size: f.size,
              modifiedAt: f.modifiedAt,
              mimeType: f.mimeType,
            }));
        } catch {
          return []; // one broken/rate-limited account shouldn't blank results from every other source
        }
      }),
    );

    const paired = loadPairedDevices();
    const onlineDevices = (
      await Promise.all(paired.map(async (d: PairedDevice) => ({ device: d, status: await isOnline(d.id, d.host, d.token) })))
    )
      .filter((d) => d.status.online)
      .map((d) => d.device);

    const deviceResults = await Promise.all(
      onlineDevices.map(async (device): Promise<SearchResult[]> => {
        const files = await fetchDeviceRecentFiles(device);
        return files
          .filter((f) => f.path.toLowerCase().includes(q))
          .map((f) => ({
            source: 'device' as const,
            sourceLabel: f.deviceName,
            deviceId: f.deviceId,
            folderId: f.folderId,
            path: f.path,
            size: f.size,
            modifiedAt: f.modifiedAt,
            mimeType: f.mimeType,
          }));
      }),
    );

    const results = [...cloudResults.flat(), ...deviceResults.flat()]
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, SEARCH_RESULT_CAP);

    return { results };
  });
}
