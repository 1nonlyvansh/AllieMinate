import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { getDeviceIdentity, getLanAddress } from '../device';
import { getCachedPath, addToCache } from '../cache';
import { categoryForFile, extFromMime, loadOpenWithPrefs } from '../openWith';
import { openLocalFile } from '../openLauncher';
import {
  loadPairedDevices,
  savePairedDevices,
  generatePairingCode,
  consumePairingCode,
  rejectPairingCode,
  pairingCodeStatus,
  findByToken,
  PairedDevice,
} from '../pairing';
import { loadMasterDeviceEnabled } from '../masterDevice';
import { logTransfer } from '../transferHistory';
import type { StorageBackend } from '../storage/StorageBackend';
import { getNearbyPeers } from '../nearbyDiscovery';
import { emitSyncEvent } from '../events';

// A cloud storage key is always forward-slash (S3-style) regardless of this backend's own OS, but a
// device-local key (the 'local' folderId family — a peer's own Desktop/Documents/etc, see
// fetchDeviceRecentFiles below) is a real filesystem path from whatever OS that PEER runs. A Windows
// peer's key is backslash-separated, and a plain split('/') leaves the whole path as the "name" instead of
// just the filename — split on either separator so both shapes reduce to a filename correctly.
function basename(key: string): string {
  return key.split(/[/\\]/).pop() ?? key;
}

const PING_TIMEOUT_MS = 4000;
const ANDROID_DEFAULT_PORT = 4311;

// A peer's self-reported host (from LocalNetwork.lanAddress()-style interface enumeration on Android, or
// equivalent) is a best-effort guess — wrong interface picked, DHCP not settled yet, VPN/hotspot present,
// etc — and once wrong it's wrong forever (nothing re-validates it). But whatever request just carried that
// claim (/pair/verify, /devices/self/host) necessarily arrived from the peer's REAL reachable address —
// Fastify's request.ip is that address, straight off the socket, guaranteed correct at this exact moment.
// Prefer it over the self-reported value whenever it's a plausible LAN address, keeping only the port from
// the claim (the connection's source port is ephemeral, not the peer's listening port).
function reconcileHost(claimedHost: string, connIp: string | undefined): string {
  if (!connIp) return claimedHost;
  const normalized = connIp.replace(/^::ffff:/, '');
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost') return claimedHost;
  if (claimedHost.startsWith('localhost:') || claimedHost.startsWith('127.0.0.1:')) return claimedHost; // USB tunnel, intentional
  const port = claimedHost.split(':')[1] || String(ANDROID_DEFAULT_PORT);
  return `${normalized}:${port}`;
}

async function testConnection(
  host: string,
  token: string,
): Promise<{ ok: boolean; error?: string; nearbyShareEnabled?: boolean; hasOwnClouds?: boolean; masterDeviceEnabled?: boolean }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch(`http://${host}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `device responded with HTTP ${res.status}` };
    // read straight off the same /status body already being fetched for the reachability check — no
    // extra round-trip just to learn whether this peer wants to show up as a Nearby Share target, or
    // whether it currently qualifies as OUR Master (has its own clouds + is willing to serve them).
    const body = await res.json().catch(() => ({}));
    return {
      ok: true,
      nearbyShareEnabled: body.nearbyShareEnabled !== false,
      hasOwnClouds: Array.isArray(body.providers) && body.providers.length > 0,
      masterDeviceEnabled: body.masterDeviceEnabled !== false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // silent before — "why is my phone Offline" was unanswerable. Now it lands in backend.log AND is
    // available on demand via GET /devices/:id/test for the UI to show directly.
    console.error(`isOnline check failed for ${host}:`, message);
    return { ok: false, error: message };
  }
}

// The tray and the main Devices page each poll /devices independently on their own schedules — with no
// shared state, one transient failed probe (a 4s-timeout blip while the phone's radio is in a low-power
// doze state, a single dropped packet) could show "Offline" in one place while the other, polling a few
// seconds apart, still shows "Online". Debounce: report offline only after a couple of CONSECUTIVE
// failures, but recover to online on the very first success — degrade slow, recover fast.
const ONLINE_FAILURE_THRESHOLD = 2;
const onlineState = new Map<string, { consecutiveFailures: number; reportedOnline: boolean }>();

export async function isOnline(
  deviceId: string,
  host: string,
  token: string,
): Promise<{ online: boolean; nearbyShareEnabled: boolean; hasOwnClouds: boolean; masterDeviceEnabled: boolean }> {
  let result = await testConnection(host, token);

  // /devices/self/host (the phone pinging US to report its new IP) only works when the phone can still
  // reach US at the OLD address — fine for a same-subnet DHCP lease renewal, but useless the moment the
  // network changes entirely (switching the Mac onto the phone's own hotspot: both sides get a brand new
  // IP in the phone's hotspot subnet, and the phone can no longer reach the Mac's old WiFi address to tell
  // it anything). The phone's Nearby beacon (NearbyBeacon.kt) already broadcasts its live id+IP on
  // whatever LAN it's currently on — including the phone's OWN hotspot subnet, since the Mac tethered to
  // it is on that exact same local network. Fall back to that broadcast to find the phone's current
  // address and heal the stale pairing record automatically, instead of requiring a manual re-pair.
  if (!result.ok) {
    const beacon = getNearbyPeers().find((p) => p.id === deviceId);
    if (beacon && beacon.host !== host) {
      const retried = await testConnection(beacon.host, token);
      if (retried.ok) {
        result = retried;
        const devices = loadPairedDevices();
        const entry = devices.find((d) => d.id === deviceId);
        if (entry) {
          entry.host = beacon.host;
          savePairedDevices(devices);
        }
      }
    }
  }

  const state = onlineState.get(deviceId) ?? { consecutiveFailures: 0, reportedOnline: false };

  if (result.ok) {
    state.consecutiveFailures = 0;
    state.reportedOnline = true;
  } else {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= ONLINE_FAILURE_THRESHOLD) state.reportedOnline = false;
  }

  onlineState.set(deviceId, state);
  // an unreachable peer can't currently qualify as anyone's Master regardless of what it last
  // reported — role is a live relationship, not a cached one, so these default to false when result.ok
  // is false rather than remembering the last-seen value.
  return {
    online: state.reportedOnline,
    nearbyShareEnabled: result.nearbyShareEnabled === true,
    hasOwnClouds: result.hasOwnClouds === true,
    masterDeviceEnabled: result.masterDeviceEnabled === true,
  };
}

// GET /devices and /devices/recent each independently await isOnline() for every paired device before
// responding — fine when everything's reachable, but a single offline device (a Windows box that's asleep,
// a phone with WiFi off) burns the full PING_TIMEOUT_MS on EVERY call, and Overview/the Devices page/the
// tray all poll this on their own separate schedules, so that timeout gets paid over and over, not once.
// Same fix as /storage's refreshProviderStorage: serve the last-known status immediately (even if it's
// about to be refreshed), refresh for real in the background, and emit a sync event so the UI can refetch
// once the fresh result lands — only a device that's NEVER been checked even once in this process has
// nothing to serve yet and has to be awaited inline.
type DeviceStatus = Awaited<ReturnType<typeof isOnline>>;
const deviceStatusCache = new Map<string, DeviceStatus>();
const deviceStatusRefreshing = new Set<string>();

async function refreshDeviceStatus(deviceId: string, host: string, token: string): Promise<DeviceStatus> {
  // a refresh for this exact device is already in flight (e.g. two /devices requests a second apart, both
  // finding a stale-but-present cache entry) — the one already running will populate the cache for both,
  // no benefit to a duplicate lookup against the same peer.
  if (deviceStatusRefreshing.has(deviceId)) {
    return deviceStatusCache.get(deviceId) ?? { online: false, nearbyShareEnabled: false, hasOwnClouds: false, masterDeviceEnabled: false };
  }
  deviceStatusRefreshing.add(deviceId);
  try {
    const status = await isOnline(deviceId, host, token);
    const prev = deviceStatusCache.get(deviceId);
    deviceStatusCache.set(deviceId, status);
    if (!prev || prev.online !== status.online) {
      // `transition: true` only when there was a previous cached value that actually flipped — the
      // renderer uses this to fire a "Connected"/"Disconnected" OS notification, and a bare first-ever
      // check of this device in this process (prev === undefined, e.g. right after backend startup) isn't
      // a real transition worth notifying about, just this process catching up to reality.
      const device = loadPairedDevices().find((d) => d.id === deviceId);
      emitSyncEvent({
        type: 'device-status-updated',
        folderId: deviceId,
        payload: { ...status, deviceName: device?.name, platform: device?.platform, transition: !!prev },
      });
    }
    return status;
  } finally {
    deviceStatusRefreshing.delete(deviceId);
  }
}

/** Cache-first status for a paired device — instant on every call after the first ever check of this
 * device in this process, since it never blocks on the network once something's cached. */
async function cachedDeviceStatus(deviceId: string, host: string, token: string): Promise<DeviceStatus> {
  const cached = deviceStatusCache.get(deviceId);
  if (cached) {
    refreshDeviceStatus(deviceId, host, token); // fire-and-forget, updates cache + emits when done
    return cached;
  }
  return refreshDeviceStatus(deviceId, host, token);
}

export interface DeviceRecentFile {
  deviceId: string;
  deviceName: string;
  folderId: string;
  path: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

// Documents/Archives are backed by a bounded-but-still-real recursive filesystem walk on the phone (see
// LocalHttpServer.kt's walkExternalStorage) — fine for the user deliberately opening that category in the
// full RemoteBrowser, but far too slow to fan out to on every tray "recent files" glance. Recent widgets
// everywhere else in the app (cloud /recent, Mac Overview) are media/document-glance tools, not full
// browsers, so this list intentionally mirrors that scope.
const RECENT_FANOUT_TIMEOUT_MS = 4000;
const SKIP_IN_RECENT_FANOUT = new Set(['documents', 'archives']);

async function fetchWithTimeout(url: string, token: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECENT_FANOUT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDeviceRecentFiles(device: PairedDevice): Promise<DeviceRecentFile[]> {
  // A Mac/Windows peer's "recent files" should mean what it means for THIS device too — its own real
  // Desktop/Documents/Downloads/Pictures/Movies/Music, not the cloud-provider folders it happens to have
  // connected. That peer runs this exact backend, so it already has the allowlist-filtered, fs.watch-backed
  // /local/recent endpoint (see localFiles.ts) — proxy straight to it instead of the folder fan-out below,
  // which was built for Android (whose "recent files" genuinely are its MediaStore-backed cloud-style
  // folders) and never made sense applied to a peer that has its own real local filesystem.
  // folderId is the literal string 'local' here, matched by the /devices/:id/folders/:folderId/download
  // route below to proxy to this same peer's /local/download instead of a cloud folder's /download.
  if (device.platform !== 'android') {
    try {
      const res = await fetchWithTimeout(`http://${device.host}/local/recent?limit=6`, device.token);
      if (!res) return [];
      const data = await res.json();
      const files: { path: string; name: string; size: number; modifiedAt: string; mimeType?: string }[] = data.files ?? [];
      return files.map((f) => ({
        deviceId: device.id,
        deviceName: device.name,
        folderId: 'local',
        path: f.path,
        size: f.size,
        modifiedAt: f.modifiedAt,
        mimeType: f.mimeType,
      }));
    } catch {
      return [];
    }
  }

  try {
    const statusRes = await fetchWithTimeout(`http://${device.host}/status`, device.token);
    if (!statusRes) return [];
    const statusData = await statusRes.json();
    const folders: { id: string; name: string }[] = (statusData.folders ?? []).filter(
      (f: { id: string }) => !SKIP_IN_RECENT_FANOUT.has(f.id),
    );

    const perFolder = await Promise.all(
      folders.map(async (folder) => {
        const filesRes = await fetchWithTimeout(`http://${device.host}/folders/${folder.id}/files`, device.token);
        if (!filesRes) return [];
        const filesData = await filesRes.json();
        const files: { path: string; size: number; modifiedAt: string; mimeType?: string }[] = filesData.files ?? [];
        return files.map((f) => ({
          deviceId: device.id,
          deviceName: device.name,
          folderId: folder.id,
          path: f.path,
          size: f.size,
          modifiedAt: f.modifiedAt,
          mimeType: f.mimeType,
        }));
      }),
    );
    return perFolder.flat().sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  } catch {
    return [];
  }
}

const execFileAsync = promisify(execFile);

// Powers the Android per-device detail screen's live battery indicator — `pmset -g batt` is the same
// source macOS's own menu bar battery reads from. Windows reads the same thing via Win32_Battery over
// WMI/CIM — untested on a real Windows machine (this dev box is a Mac), so treat this branch as
// unverified until confirmed on Windows; report unsupported (null) rather than crash if the command
// itself fails on some Windows configuration this wasn't tested against.
async function readBattery(): Promise<{ percent: number; charging: boolean } | null> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('pmset', ['-g', 'batt']);
      const percentMatch = stdout.match(/(\d+)%/);
      if (!percentMatch) return null; // desktop Mac with no battery
      return { percent: parseInt(percentMatch[1], 10), charging: stdout.includes("'AC Power'") };
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') {
    try {
      // BatteryStatus 2 == "AC power" (Win32_Battery's own enum — 1 is "discharging", 2 is "on AC/charging").
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress',
      ]);
      const trimmed = stdout.trim();
      if (!trimmed) return null; // desktop PC with no battery — Win32_Battery returns nothing
      const parsed = JSON.parse(trimmed);
      const percent = parsed.EstimatedChargeRemaining;
      if (typeof percent !== 'number') return null;
      return { percent, charging: parsed.BatteryStatus === 2 };
    } catch {
      return null;
    }
  }
  return null;
}

export function registerDeviceRoutes(app: FastifyInstance, backends: Map<string, StorageBackend>): void {
  app.get('/device-info', async () => {
    const me = getDeviceIdentity();
    return { ...me, lanAddress: getLanAddress() };
  });

  app.get('/battery', async (_req, reply) => {
    const battery = await readBattery();
    if (!battery) return reply.code(404).send({ error: 'battery info not available on this device' });
    return battery;
  });

  app.post('/pair/start', async (_req, reply) => {
    if (!loadMasterDeviceEnabled()) {
      return reply.code(403).send({ error: 'Master Device is turned off — enable it in Settings to let phones pair with this Mac.' });
    }
    const code = generatePairingCode();
    const me = getDeviceIdentity();
    return { code, deviceName: me.name, lanAddress: getLanAddress(), port: (app.server.address() as { port: number } | null)?.port };
  });

  // USB pairing's branded confirm-on-phone step (Yes/No + biometric) needs a way to tell the Mac "no" —
  // the phone can always reach the Mac (that's the direction pairing already proves works), so it just
  // posts the rejection back against the same code.
  app.post<{ Body: { code: string } }>('/pair/reject', async (req, reply) => {
    if (!req.body?.code) return reply.code(400).send({ error: 'missing code' });
    rejectPairingCode(req.body.code);
    return { ok: true };
  });

  app.get<{ Querystring: { code: string } }>('/pair/status', async (req, reply) => {
    if (!req.query.code) return reply.code(400).send({ error: 'missing code' });
    return { status: pairingCodeStatus(req.query.code) };
  });

  app.post<{ Body: { code: string; requester: { id: string; name: string; platform: NodeJS.Platform; host: string } } }>(
    '/pair/verify',
    async (req, reply) => {
      const { code, requester } = req.body;
      if (!consumePairingCode(code)) {
        return reply.code(400).send({ error: 'invalid or expired code' });
      }

      const token = crypto.randomUUID();
      const host = reconcileHost(requester.host, req.ip);
      const devices = loadPairedDevices().filter((d) => d.id !== requester.id);
      devices.push({ ...requester, host, token, pairedAt: new Date().toISOString() });
      savePairedDevices(devices);

      const me = getDeviceIdentity();
      return { ...me, token };
    },
  );

  app.post<{ Body: { host: string; code: string } }>('/pair/connect', async (req, reply) => {
    const { host, code } = req.body;
    if (!host || !code) return reply.code(400).send({ error: 'missing host or code' });

    const me = getDeviceIdentity();
    const myAddress = getLanAddress();
    const myPort = (app.server.address() as { port: number } | null)?.port;
    if (!myAddress || !myPort) return reply.code(500).send({ error: "couldn't determine this device's LAN address" });

    let res: Response;
    try {
      res = await fetch(`http://${host}/pair/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, requester: { ...me, host: `${myAddress}:${myPort}` } }),
      });
    } catch (err) {
      return reply.code(502).send({ error: `couldn't reach ${host}: ${err instanceof Error ? err.message : String(err)}` });
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return reply.code(res.status).send({ error: data.error ?? 'pairing rejected' });
    }

    const peer = (await res.json()) as { id: string; name: string; platform: NodeJS.Platform; token: string };
    const devices = loadPairedDevices().filter((d) => d.id !== peer.id);
    devices.push({ id: peer.id, name: peer.name, platform: peer.platform, host, token: peer.token, pairedAt: new Date().toISOString() });
    savePairedDevices(devices);

    return { ok: true, device: { id: peer.id, name: peer.name, platform: peer.platform } };
  });

  // A phone's LAN IP can change after sitting locked/idle for a few minutes (DHCP lease renewal is the
  // common case) — without this, the Mac keeps trying the OLD address forever and the only way to recover
  // was a full unpair/re-pair (which just re-learns the current address once). The phone already pings
  // this Mac periodically to keep its own "sharing active" self-check going (DevicesScreen.kt); piggybacking
  // a fresh host announcement onto that loop means a changed IP gets picked up within one ping interval
  // instead of requiring the user to notice and manually re-pair.
  app.post<{ Body: { host: string } }>('/devices/self/host', async (req, reply) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const device = token ? findByToken(token) : undefined;
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const claimedHost = req.body.host?.trim();
    if (!claimedHost) return reply.code(400).send({ error: 'missing host' });
    const newHost = reconcileHost(claimedHost, req.ip);
    if (newHost === device.host) return { ok: true, changed: false };

    const devices = loadPairedDevices();
    const entry = devices.find((d) => d.id === device.id);
    if (entry) {
      entry.host = newHost;
      savePairedDevices(devices);
    }
    return { ok: true, changed: true, host: newHost };
  });

  app.get('/devices', async () => {
    const me = getDeviceIdentity();
    const paired = loadPairedDevices();
    const withStatus = await Promise.all(
      paired.map(async (d) => {
        const status = await cachedDeviceStatus(d.id, d.host, d.token);
        return {
          id: d.id,
          name: d.name,
          platform: d.platform,
          host: d.host,
          pairedAt: d.pairedAt,
          online: status.online,
          nearbyShareEnabled: status.nearbyShareEnabled,
          hasOwnClouds: status.hasOwnClouds,
          masterDeviceEnabled: status.masterDeviceEnabled,
          universalClipboardEnabled: d.universalClipboardEnabled === true,
        };
      }),
    );
    // Master/Under is a relationship, not an OS — this device's own role is just its own current state,
    // computed the exact same way a peer computes it about US via testConnection reading our /status.
    const thisDeviceRole = { hasOwnClouds: backends.size > 0, masterDeviceEnabled: loadMasterDeviceEnabled() };
    return { thisDevice: me, thisDeviceRole, paired: withStatus };
  });

  // Genuinely unpaired devices discovered via LAN broadcast — deliberately excludes anything already in
  // the paired list. A device you've already paired belongs in Paired Devices ONLY, never duplicated into
  // Nearby Share just because it also happens to have that toggle on.
  app.get('/devices/nearby', async () => {
    const pairedIds = new Set(loadPairedDevices().map((d) => d.id));
    const nearby = getNearbyPeers().filter((p) => !pairedIds.has(p.id));
    return { nearby };
  });

  // Recent files across every ONLINE paired device — powers the menu bar's "Recent Devices Files"
  // section. Reuses the exact same per-device proxy routes below, just fans out and merges.
  app.get('/devices/recent', async () => {
    const paired = loadPairedDevices();
    const onlineDevices = (
      await Promise.all(paired.map(async (d) => ({ device: d, status: await cachedDeviceStatus(d.id, d.host, d.token) })))
    )
      .filter((d) => d.status.online)
      .map((d) => d.device);

    const results = await Promise.all(onlineDevices.map((device) => fetchDeviceRecentFiles(device)));

    const merged = results
      .flat()
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 12);

    return { files: merged, onlineDeviceCount: onlineDevices.length };
  });

  // Single-device recent files — powers the tray's per-device horizontal scroller (clicking a device
  // name shows just its own most-recent files, not the global cross-device merge which can crowd a
  // quieter device out of the top-12 list above).
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/devices/:id/recent', async (req, reply) => {
    const paired = loadPairedDevices();
    const device = paired.find((d) => d.id === req.params.id);
    if (!device) return reply.code(404).send({ error: 'device not paired' });
    const limit = Math.min(Number(req.query.limit) || 6, 24);
    const files = (await fetchDeviceRecentFiles(device)).slice(0, limit);
    return { files };
  });

  app.delete<{ Params: { id: string } }>('/devices/:id', async (req) => {
    const target = loadPairedDevices().find((d) => d.id === req.params.id);
    const devices = loadPairedDevices().filter((d) => d.id !== req.params.id);
    savePairedDevices(devices);

    // Unpairing from this side only ever removed OUR OWN record — the other device never found out, so
    // it just kept showing us as "Offline" forever instead of actually unpaired (its own token still on
    // file, still trying to reach us). Best-effort, fire-and-forget: don't block this response on it, and
    // don't fail the (already-completed) local removal if the other device is unreachable — same
    // reasoning Android's own unpair already uses in reverse (MasterApi.unpair in DevicesScreen.kt).
    if (target) {
      fetch(`http://${target.host}/unpair`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.token}` },
      }).catch(() => {});
    }

    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; universalClipboardEnabled?: boolean } }>('/devices/:id', async (req, reply) => {
    const devices = loadPairedDevices();
    const device = devices.find((d) => d.id === req.params.id);
    if (!device) return reply.code(404).send({ error: 'device not paired' });

    if (req.body?.name !== undefined) {
      const name = req.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'missing name' });
      device.name = name;
    }
    if (req.body?.universalClipboardEnabled !== undefined) {
      device.universalClipboardEnabled = req.body.universalClipboardEnabled;
    }
    savePairedDevices(devices);
    return { ok: true };
  });

  function findPeer(id: string): PairedDevice | undefined {
    return loadPairedDevices().find((d) => d.id === id);
  }

  // on-demand diagnostic for "why does this show Offline" — same check the /devices list uses, but
  // returns the real error (timeout / connection refused / HTTP status) instead of collapsing it to a
  // boolean, so the UI can show it directly instead of sending the user spelunking through backend.log.
  app.get<{ Params: { id: string } }>('/devices/:id/test', async (req, reply) => {
    const peer = findPeer(req.params.id);
    if (!peer) return reply.code(404).send({ error: 'device not paired' });
    return testConnection(peer.host, peer.token);
  });

  app.get<{ Params: { id: string } }>('/devices/:id/folders', async (req, reply) => {
    const peer = findPeer(req.params.id);
    if (!peer) return reply.code(404).send({ error: 'device not paired' });

    try {
      const res = await fetch(`http://${peer.host}/status`, { headers: { Authorization: `Bearer ${peer.token}` } });
      if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
      const data = await res.json();
      return { folders: data.folders ?? [] };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string; folderId: string } }>('/devices/:id/folders/:folderId/files', async (req, reply) => {
    const peer = findPeer(req.params.id);
    if (!peer) return reply.code(404).send({ error: 'device not paired' });

    try {
      const res = await fetch(`http://${peer.host}/folders/${req.params.folderId}/files`, {
        headers: { Authorization: `Bearer ${peer.token}` },
      });
      if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
      return res.json();
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string; folderId: string }; Querystring: { key: string } }>(
    '/devices/:id/folders/:folderId/download',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });

      try {
        // 'local' is the sentinel fetchDeviceRecentFiles uses for a Mac/Windows peer's own local files
        // (see above) — key is that peer's real filesystem path, served by its own /local/download,
        // not a cloud-folder key served by /folders/:id/download.
        const upstreamUrl = req.params.folderId === 'local'
          ? `http://${peer.host}/local/download?path=${encodeURIComponent(req.query.key)}`
          : `http://${peer.host}/folders/${req.params.folderId}/download?key=${encodeURIComponent(req.query.key)}`;
        const res = await fetch(upstreamUrl, { headers: { Authorization: `Bearer ${peer.token}` } });
        if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
        const buf = Buffer.from(await res.arrayBuffer());
        logTransfer({
          deviceId: peer.id,
          deviceName: peer.name,
          fileName: basename(req.query.key),
          direction: 'received',
          size: buf.length,
          path: 'Downloads (saved by browser)',
        });
        reply.header('Content-Type', 'application/octet-stream');
        return reply.send(buf);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Devices > "Cloud" tab — relays a paired device's own Sync Pairs (Sync Engine + Universal Sync, both
  // of which store as SyncPair records) the exact same way the /devices/:id/local-folders trio relays a
  // real filesystem. Android's LocalHttpServer registers this family at the bare path /sync-pairs; the
  // Mac/Windows backend (this exact codebase, running as the peer) registers its own copy at /sync/pairs
  // instead — same feature, different route prefix per platform.
  function syncPairsUpstreamPath(peer: PairedDevice): string {
    return peer.platform === 'android' ? '/sync-pairs' : '/sync/pairs';
  }

  app.get<{ Params: { id: string } }>('/devices/:id/sync-pairs', async (req, reply) => {
    const peer = findPeer(req.params.id);
    if (!peer) return reply.code(404).send({ error: 'device not paired' });

    try {
      const res = await fetch(`http://${peer.host}${syncPairsUpstreamPath(peer)}`, { headers: { Authorization: `Bearer ${peer.token}` } });
      if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
      const data = await res.json();
      // Cloud tab reuses the same {folders:[...]} shape every other device-browsing route already
      // returns — both platforms' own sync-pair list route calls the field `pairs`, so rename it here
      // once instead of teaching the frontend two different field names for the same tab.
      return { folders: data.pairs ?? [] };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string; pairId: string } }>('/devices/:id/sync-pairs/:pairId/files', async (req, reply) => {
    const peer = findPeer(req.params.id);
    if (!peer) return reply.code(404).send({ error: 'device not paired' });

    try {
      const res = await fetch(`http://${peer.host}${syncPairsUpstreamPath(peer)}/${req.params.pairId}/files`, {
        headers: { Authorization: `Bearer ${peer.token}` },
      });
      if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
      const data = await res.json();
      // The Mac/Windows backend's own sync-pair files route names the field relPath (it doubles as a
      // sync-state record); Android's names it path. Normalize to path so this family looks identical to
      // /folders and /local-folders regardless of which platform the peer turns out to be.
      const files = (data.files ?? []).map((f: Record<string, unknown>) => ({ ...f, path: f.path ?? f.relPath }));
      return { files };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string; pairId: string }; Querystring: { key: string } }>(
    '/devices/:id/sync-pairs/:pairId/download',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });

      try {
        const res = await fetch(
          `http://${peer.host}${syncPairsUpstreamPath(peer)}/${req.params.pairId}/download?key=${encodeURIComponent(req.query.key)}`,
          { headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
        const buf = Buffer.from(await res.arrayBuffer());
        logTransfer({
          deviceId: peer.id,
          deviceName: peer.name,
          fileName: basename(req.query.key),
          direction: 'received',
          size: buf.length,
          path: 'Downloads (saved by browser)',
        });
        reply.header('Content-Type', 'application/octet-stream');
        return reply.send(buf);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string; pairId: string }; Body: { key: string; mimeType?: string } }>(
    '/devices/:id/sync-pairs/:pairId/cache-path',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const filePath = await resolveDeviceCachedPath(peer, req.params.pairId, req.body.key, req.body.mimeType, 'sync-pair');
        return { ok: true, path: filePath };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string; pairId: string }; Body: { key: string; mimeType?: string } }>(
    '/devices/:id/sync-pairs/:pairId/open',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const filePath = await resolveDeviceCachedPath(peer, req.params.pairId, req.body.key, req.body.mimeType, 'sync-pair');
        const name = basename(req.body.key);
        const category = categoryForFile(name, req.body.mimeType);
        const appPath = category ? loadOpenWithPrefs()[category] : undefined;
        openLocalFile(filePath, appPath, (err) => app.log.error(err, 'failed to open device file'));
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { id: string; folderId: string }; Querystring: { key: string } }>(
    '/devices/:id/folders/:folderId/thumbnail',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const res = await fetch(
          `http://${peer.host}/folders/${req.params.folderId}/thumbnail?key=${encodeURIComponent(req.query.key)}`,
          { headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'no thumbnail available' });
        reply.header('Content-Type', 'image/jpeg');
        return reply.send(Buffer.from(await res.arrayBuffer()));
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete<{ Params: { id: string; folderId: string }; Querystring: { key: string } }>(
    '/devices/:id/folders/:folderId/file',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const res = await fetch(
          `http://${peer.host}/folders/${req.params.folderId}/file?key=${encodeURIComponent(req.query.key)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device rejected the delete' });
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.patch<{ Params: { id: string; folderId: string }; Body: { key: string; newName: string } }>(
    '/devices/:id/folders/:folderId/file',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      const { key, newName } = req.body;
      if (!key || !newName) return reply.code(400).send({ error: 'missing key or newName' });
      try {
        const res = await fetch(
          `http://${peer.host}/folders/${req.params.folderId}/file?key=${encodeURIComponent(key)}&newName=${encodeURIComponent(newName)}`,
          { method: 'PATCH', headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device rejected the rename' });
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Real OS folders on a paired desktop peer (Desktop/Downloads/Documents/Pictures/Videos/Music, custom
  // shortcuts, Received) — as opposed to the /devices/:id/folders/* trio above, which browses the peer's
  // CLOUD-backed folders. Same proxy shape as that existing family, just pointed at the peer's
  // /local-folders/* routes instead of /folders/*.
  app.get<{ Params: { id: string } }>('/devices/:id/local-folders', async (req, reply) => {
    const peer = findPeer(req.params.id);
    if (!peer) return reply.code(404).send({ error: 'device not paired' });
    try {
      const res = await fetch(`http://${peer.host}/local-folders`, { headers: { Authorization: `Bearer ${peer.token}` } });
      if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
      return res.json();
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string; folderId: string }; Querystring: { path?: string } }>(
    '/devices/:id/local-folders/:folderId/files',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      const qs = req.query.path ? `?path=${encodeURIComponent(req.query.path)}` : '';
      try {
        const res = await fetch(`http://${peer.host}/local-folders/${req.params.folderId}/files${qs}`, {
          headers: { Authorization: `Bearer ${peer.token}` },
        });
        if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
        return res.json();
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string; folderId: string }; Body: { path?: string; name: string } }>(
    '/devices/:id/local-folders/:folderId/mkdir',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const res = await fetch(`http://${peer.host}/local-folders/${req.params.folderId}/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${peer.token}` },
          body: JSON.stringify(req.body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return reply.code(res.status === 400 ? 400 : 502).send(data);
        return data;
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { id: string; folderId: string }; Querystring: { key: string } }>(
    '/devices/:id/local-folders/:folderId/download',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const res = await fetch(
          `http://${peer.host}/local-folders/${req.params.folderId}/download?key=${encodeURIComponent(req.query.key)}`,
          { headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
        const buf = Buffer.from(await res.arrayBuffer());
        logTransfer({
          deviceId: peer.id,
          deviceName: peer.name,
          fileName: basename(req.query.key),
          direction: 'received',
          size: buf.length,
          path: 'Downloads (saved by browser)',
        });
        reply.header('Content-Type', 'application/octet-stream');
        return reply.send(buf);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string; folderId: string }; Querystring: { name: string } }>(
    '/devices/:id/local-folders/:folderId/upload',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      const { name } = req.query;
      if (!name) return reply.code(400).send({ error: 'missing ?name=' });
      try {
        const from = getDeviceIdentity().name;
        const res = await fetch(
          `http://${peer.host}/local-folders/${req.params.folderId}/upload?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${peer.token}` },
            body: new Uint8Array(req.body as Buffer),
          },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device rejected the file' });
        const result = await res.json();
        logTransfer({
          deviceId: peer.id,
          deviceName: peer.name,
          fileName: name,
          direction: 'sent',
          size: (req.body as Buffer).length,
          path: `${req.params.folderId}/${name}`,
        });
        return result;
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete<{ Params: { id: string; folderId: string }; Querystring: { key: string } }>(
    '/devices/:id/local-folders/:folderId/file',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const res = await fetch(
          `http://${peer.host}/local-folders/${req.params.folderId}/file?key=${encodeURIComponent(req.query.key)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device rejected the delete' });
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.patch<{ Params: { id: string; folderId: string }; Body: { key: string; newName: string } }>(
    '/devices/:id/local-folders/:folderId/file',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      const { key, newName } = req.body;
      if (!key || !newName) return reply.code(400).send({ error: 'missing key or newName' });
      try {
        const res = await fetch(
          `http://${peer.host}/local-folders/${req.params.folderId}/file?key=${encodeURIComponent(key)}&newName=${encodeURIComponent(newName)}`,
          { method: 'PATCH', headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device rejected the rename' });
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string; folderId: string }; Body: { key: string; mimeType?: string } }>(
    '/devices/:id/local-folders/:folderId/cache-path',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const filePath = await resolveDeviceCachedPath(peer, req.params.folderId, req.body.key, req.body.mimeType, 'local-folder');
        return { ok: true, path: filePath };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string; folderId: string }; Body: { key: string; mimeType?: string } }>(
    '/devices/:id/local-folders/:folderId/open',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const filePath = await resolveDeviceCachedPath(peer, req.params.folderId, req.body.key, req.body.mimeType, 'local-folder');
        const name = basename(req.body.key);
        const category = categoryForFile(name, req.body.mimeType);
        const appPath = category ? loadOpenWithPrefs()[category] : undefined;
        openLocalFile(filePath, appPath, (err) => app.log.error(err, 'failed to open device local file'));
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // pulls a file's bytes straight from the phone and pushes them into a chosen cloud service — the phone
  // never talks to the cloud provider directly, this Mac is just relaying the bytes through in one request.
  app.post<{ Params: { id: string; folderId: string }; Body: { key: string; destProviderId: string; destFolderId?: string } }>(
    '/devices/:id/folders/:folderId/copy-to-cloud',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });

      const { key, destProviderId, destFolderId } = req.body;
      if (!key || !destProviderId) return reply.code(400).send({ error: 'missing key or destProviderId' });

      const backend = backends.get(destProviderId);
      if (!backend?.putInFolder) return reply.code(409).send({ error: 'destination cloud service not configured' });

      try {
        const res = await fetch(
          `http://${peer.host}/folders/${req.params.folderId}/download?key=${encodeURIComponent(key)}`,
          { headers: { Authorization: `Bearer ${peer.token}` } },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device unreachable' });
        const data = Buffer.from(await res.arrayBuffer());
        const name = basename(key);
        await backend.putInFolder(destFolderId ?? null, name, data);
        return { ok: true, name, size: data.length };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Downloads a phone file into the same local cache /files/open and /files/cache-path use for cloud
  // files, keyed per-device-per-folder so it can't collide with a cloud file that happens to share a name.
  async function resolveDeviceCachedPath(
    peer: PairedDevice,
    folderId: string,
    key: string,
    mimeType?: string,
    kind: 'folder' | 'sync-pair' | 'local-folder' = 'folder',
  ): Promise<string> {
    const providerKey = `device:${peer.id}:${kind}:${folderId}`;
    const cached = getCachedPath(providerKey, key);
    if (cached) return cached;

    const remotePath =
      kind === 'sync-pair' ? `${syncPairsUpstreamPath(peer).slice(1)}/${folderId}` :
      kind === 'local-folder' ? `local-folders/${folderId}` : `folders/${folderId}`;
    const res = await fetch(`http://${peer.host}/${remotePath}/download?key=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${peer.token}` },
    });
    if (!res.ok) throw new Error('device unreachable');
    const data = Buffer.from(await res.arrayBuffer());
    const name = basename(key);
    const displayName = path.extname(name) ? name : `${name}${mimeType ? `.${extFromMime(mimeType) ?? 'bin'}` : ''}`;
    return addToCache(providerKey, key, data, displayName);
  }

  // "Copy to Clipboard" for a phone file — same reasoning as the cloud version: a real pasteboard file-url
  // paste needs an actual local file, so this caches it here first.
  app.post<{ Params: { id: string; folderId: string }; Body: { key: string; mimeType?: string } }>(
    '/devices/:id/folders/:folderId/cache-path',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const filePath = await resolveDeviceCachedPath(peer, req.params.folderId, req.body.key, req.body.mimeType);
        return { ok: true, path: filePath };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string; folderId: string }; Body: { key: string; mimeType?: string } }>(
    '/devices/:id/folders/:folderId/open',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      try {
        const filePath = await resolveDeviceCachedPath(peer, req.params.folderId, req.body.key, req.body.mimeType);
        const name = basename(req.body.key);
        const category = categoryForFile(name, req.body.mimeType);
        const appPath = category ? loadOpenWithPrefs()[category] : undefined;
        openLocalFile(filePath, appPath, (err) => app.log.error(err, 'failed to open device file'));
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // pushes a file straight to a paired device — used for device-to-device Share. Lands in the peer's own
  // inbox, NOT a cloud-backed FolderConfig folder: this used to hit /folders/:destFolderId/upload, which
  // required the peer to already have a matching cloud folder configured and silently left the Send button
  // permanently disabled when it didn't — and even when a folder DID resolve, that route has no relation
  // to "drag a file onto a paired device," it's for cloud uploads.
  //
  // The peer's actual inbox route differs by platform — a Mac/Windows peer runs this same backend and
  // exposes /inbox/upload, but Android's LocalHttpServer has no such route at all; its equivalent is
  // /folders/received/upload (the one route Android names "received"). Fixed here after discovering the
  // desktop-only version 404'd against every phone (a Mac-to-Mac/Windows fix that broke Mac-to-Android —
  // both routes log the transfer and fire a receive event on their own side, this just picks the right URL).
  app.post<{ Params: { id: string }; Querystring: { name: string } }>(
    '/devices/:id/share',
    async (req, reply) => {
      const peer = findPeer(req.params.id);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });

      const { name } = req.query;
      if (!name) return reply.code(400).send({ error: 'missing name' });

      const inboxPath = peer.platform === 'android' ? '/folders/received/upload' : '/inbox/upload';

      try {
        const from = getDeviceIdentity().name;
        const res = await fetch(
          `http://${peer.host}${inboxPath}?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${peer.token}` },
            body: new Uint8Array(req.body as Buffer),
          },
        );
        if (!res.ok) return reply.code(502).send({ error: 'device rejected the file' });
        const result = await res.json();
        logTransfer({
          deviceId: peer.id,
          deviceName: peer.name,
          fileName: name,
          direction: 'sent',
          size: (req.body as Buffer).length,
          path: `Sent to ${peer.name}`,
        });
        return result;
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Phase 3: Phone as Remote Unlock/Approve — sender side. This gates ONLY AllieMinate's own in-app App
  // Lock (LockScreen.tsx's PIN/Touch ID screen); there is no path from here to the OS's actual login/lock
  // screen, and no third-party app can bypass that. Stateless beyond "which paired devices did we ask" —
  // the real pending/accepted/declined state lives on each peer (see unlockApproval.ts), this Mac just
  // polls them. Both routes are loopback-only in practice: LockScreen calls them via 127.0.0.1, and the
  // top-level onRequest hook already exempts loopback from needing its own Bearer token.
  const pendingUnlockAsks = new Map<string, string[]>(); // requestId -> deviceIds asked

  app.post('/unlock/broadcast', async () => {
    const paired = loadPairedDevices();
    if (paired.length === 0) return { error: 'no paired devices to ask' };

    const requestId = crypto.randomUUID();
    const fromName = getDeviceIdentity().name;
    const deviceIds = paired.map((d) => d.id);
    pendingUnlockAsks.set(requestId, deviceIds);

    for (const peer of paired) {
      fetch(`http://${peer.host}/unlock/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${peer.token}` },
        body: JSON.stringify({ requestId, fromName }),
      }).catch(() => {}); // fire-and-forget — an unreachable peer just never contributes a vote
    }

    return { requestId, askedCount: deviceIds.length };
  });

  // Polled by LockScreen every ~1.5s. Deliberately re-checks every asked peer live each call rather than
  // caching a push-back result — a peer saying "accepted" is the only outcome that matters and it wins the
  // moment any single one reports it, so a phone that was briefly unreachable can still catch up.
  app.get<{ Params: { requestId: string } }>('/unlock/status/:requestId', async (req, reply) => {
    const deviceIds = pendingUnlockAsks.get(req.params.requestId);
    if (!deviceIds) return reply.code(404).send({ error: 'unknown or already-resolved request' });

    const paired = loadPairedDevices();
    const statuses = await Promise.all(
      deviceIds.map(async (id) => {
        const peer = paired.find((d) => d.id === id);
        if (!peer) return 'expired';
        try {
          const res = await fetch(`http://${peer.host}/unlock/request/${req.params.requestId}/status`, {
            headers: { Authorization: `Bearer ${peer.token}` },
          });
          if (!res.ok) return 'pending';
          const data = await res.json();
          return typeof data.status === 'string' ? data.status : 'pending';
        } catch {
          return 'pending'; // unreachable right now, not the same as declined — give it another poll
        }
      }),
    );

    if (statuses.includes('accepted')) {
      pendingUnlockAsks.delete(req.params.requestId);
      return { status: 'accepted' };
    }
    if (statuses.every((s) => s === 'declined' || s === 'expired')) {
      pendingUnlockAsks.delete(req.params.requestId);
      return { status: statuses.includes('declined') ? 'declined' : 'expired' };
    }
    return { status: 'pending' };
  });
}

// Real-time cross-device recent-files: a Mac/Windows peer's own backend already emits
// 'local-recent-updated' on ITS OWN /ws the instant something changes under its watched folders (see
// localFiles.ts's startLocalRecentWatcher) — but that event only reaches clients connected to THAT peer's
// websocket, not this device's. This backend opens an outbound connection to each such peer's /ws, listens
// for that event, and re-emits it on this backend's own event bus as 'device-recent-updated' (tagged with
// the peer's own device id) so the tray's DeviceRecentStrip can react to it exactly like a local change —
// without this, a paired device's recent-files strip only ever refreshes on its own poll tick.
const peerRecentWatchers = new Map<string, WebSocket>();

function connectToPeerRecentUpdates(peer: PairedDevice): void {
  // Android has no local-recent-updated event to relay (no equivalent local-file watcher exists there) —
  // nothing to connect to.
  if (peer.platform === 'android' || peerRecentWatchers.has(peer.id)) return;
  const ws = new WebSocket(`ws://${peer.host}/ws`);
  peerRecentWatchers.set(peer.id, ws);
  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      if (event.type === 'local-recent-updated') {
        emitSyncEvent({ type: 'device-recent-updated', folderId: peer.id, payload: null });
      }
    } catch {
      // not JSON, or not a SyncEvent shape — ignore
    }
  });
  // no reconnect-with-backoff here on purpose — syncPeerRecentWatchers() runs on an interval and will
  // naturally reopen this connection next tick since a closed socket is removed from the map immediately.
  ws.on('close', () => peerRecentWatchers.delete(peer.id));
  ws.on('error', () => ws.close());
}

/** Called once at backend startup and on an interval — opens outbound watchers for any newly-paired
 * device, retries any that dropped (peer went offline, network blip), and closes any for a device that
 * was unpaired since the last call. */
export function syncPeerRecentWatchers(): void {
  const current = loadPairedDevices();
  const currentIds = new Set(current.map((d) => d.id));
  for (const peer of current) connectToPeerRecentUpdates(peer);
  for (const [id, ws] of peerRecentWatchers) {
    if (!currentIds.has(id)) {
      ws.close();
      peerRecentWatchers.delete(id);
    }
  }
}
