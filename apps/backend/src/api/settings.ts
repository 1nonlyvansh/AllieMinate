import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { loadMasterDeviceEnabled, setMasterDeviceEnabled } from '../masterDevice';
import { loadReceivePath, saveReceivePath, defaultReceivePath } from '../receiveSettings';
import { loadUsername, saveUsername } from '../username';
import { loadNearbyShareEnabled, setNearbyShareEnabled } from '../nearbyShare';
import { loadBandwidthLimit, saveBandwidthLimit } from '../sync/bandwidthThrottle';
import { loadTrayFilterProvider } from '../trayFilter';

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/settings/master-device', async () => ({ enabled: loadMasterDeviceEnabled() }));

  app.post<{ Body: { enabled: boolean } }>('/settings/master-device', async (req) => {
    setMasterDeviceEnabled(req.body.enabled === true);
    return { ok: true, enabled: req.body.enabled === true };
  });

  app.get('/settings/username', async () => ({ username: loadUsername() }));

  app.post<{ Body: { username: string } }>('/settings/username', async (req, reply) => {
    const username = req.body.username?.trim();
    if (!username) return reply.code(400).send({ error: 'missing username' });
    saveUsername(username);
    return { ok: true, username };
  });

  app.get('/settings/receive-path', async () => ({ path: loadReceivePath(), default: defaultReceivePath() }));

  app.post<{ Body: { path: string } }>('/settings/receive-path', async (req, reply) => {
    const newPath = req.body.path?.trim();
    if (!newPath) return reply.code(400).send({ error: 'missing path' });
    fs.mkdirSync(newPath, { recursive: true });
    saveReceivePath(newPath);
    return { ok: true, path: newPath };
  });

  app.get('/settings/nearby-share', async () => ({ enabled: loadNearbyShareEnabled() }));

  app.post<{ Body: { enabled: boolean } }>('/settings/nearby-share', async (req) => {
    setNearbyShareEnabled(req.body.enabled === true);
    return { ok: true, enabled: req.body.enabled === true };
  });

  app.get('/settings/bandwidth-limit', async () => ({ bytesPerSec: loadBandwidthLimit() }));

  app.post<{ Body: { bytesPerSec: number | null } }>('/settings/bandwidth-limit', async (req) => {
    const value = typeof req.body.bytesPerSec === 'number' && req.body.bytesPerSec > 0 ? req.body.bytesPerSec : null;
    saveBandwidthLimit(value);
    return { ok: true, bytesPerSec: value };
  });

  // GET only — restores the tray's provider dropdown to its last selection on a fresh open. Nothing
  // POSTs here anymore: the tray persists a new selection as a side effect of its own /recent?provider=
  // fetch (see server.ts), so the selector and the effect are always in sync with no separate save step.
  app.get('/settings/tray-filter', async () => ({ providerId: loadTrayFilterProvider() }));
}
