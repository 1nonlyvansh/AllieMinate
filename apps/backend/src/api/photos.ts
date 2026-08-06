import type { FastifyInstance } from 'fastify';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openLocalFile, openExternalUrl } from '../openLauncher';
import { loadPhotosAccounts, savePhotosAccounts, nextPhotosAccountId } from '../photosAccounts';
import { getPickedItems, addPickedItems, removePickedForAccount, removePickedItem } from '../photosPicked';
import { loadPairedDevices } from '../pairing';
import { getDeviceIdentity } from '../device';
import { logTransfer } from '../transferHistory';
import { getNearbyPeers } from '../nearbyDiscovery';
import { sendBytesToNearbyPeer } from '../nearbyTransfer';

const PHOTOS_OAUTH_PORT = 53687;
// Google retired broad mediaItems.list/search access for third-party apps on 2025-03-31 — the only way
// left to read a user's photos is the Picker API, where the user explicitly selects items in a
// Google-hosted picker session. photoslibrary.readonly no longer grants anything useful here.
const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly https://www.googleapis.com/auth/userinfo.email';
const PICKER_API = 'https://photospicker.googleapis.com/v1';

const accessTokenCache = new Map<string, { refreshToken: string; token: string; expiresAt: number }>();
// a revoked/expired refresh token (invalid_grant) can never succeed until the user re-links the account —
// without this, every thumbnail load, search hit, or send action for that account retried the failing
// OAuth refresh call from scratch (same "never cache a failure" shape that hammered the app earlier for
// B2's transaction cap and the primary Drive account's own revoked token).
const accessTokenFailures = new Map<string, { refreshToken: string; failedAt: number }>();
const TOKEN_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

async function getAccessToken(accountId: string, refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  // keyed on accountId, but accountId gets reused when a removed account is re-added — a stale cache
  // entry from the OLD refresh token (e.g. one missing a newly-authorized scope) must not survive that.
  const cached = accessTokenCache.get(accountId);
  if (cached && cached.refreshToken === refreshToken && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const failure = accessTokenFailures.get(accountId);
  if (failure && failure.refreshToken === refreshToken && Date.now() - failure.failedAt < TOKEN_FAILURE_COOLDOWN_MS) {
    throw new Error('Google Photos token refresh failed recently — retrying automatically, try again shortly');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    accessTokenFailures.set(accountId, { refreshToken, failedAt: Date.now() });
    throw new Error(`Google Photos token refresh failed: ${data.error_description ?? data.error}`);
  }

  accessTokenFailures.delete(accountId);
  accessTokenCache.set(accountId, {
    refreshToken,
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

// shared by the thumbnail proxy (below) and the Send-to-Device/Nearby routes — a Picker API baseUrl needs
// a fresh Authorization header to fetch actual bytes, unlike the old Library API's directly-fetchable URLs.
async function fetchPhotoBytes(accountId: string, baseUrl: string): Promise<Buffer> {
  const account = loadPhotosAccounts().find((a) => a.accountId === accountId);
  if (!account) throw new Error('account not found');
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('missing GOOGLE_DRIVE_CLIENT_ID/SECRET in .env');

  const token = await getAccessToken(account.accountId, account.refreshToken, clientId, clientSecret);
  const res = await fetch(`${baseUrl}=d`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('failed to fetch photo');
  return Buffer.from(await res.arrayBuffer());
}

function requireGoogleCreds(reply: any): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    reply.code(400).send({ error: 'missing GOOGLE_DRIVE_CLIENT_ID/SECRET in .env' });
    return null;
  }
  return { clientId, clientSecret };
}

export function registerPhotosRoutes(app: FastifyInstance): void {
  app.get('/photos/accounts', async () => ({
    accounts: loadPhotosAccounts().map((a) => ({ accountId: a.accountId, label: a.label })),
  }));

  app.delete<{ Params: { id: string } }>('/photos/accounts/:id', async (req, reply) => {
    const accounts = loadPhotosAccounts();
    if (!accounts.some((a) => a.accountId === req.params.id)) {
      return reply.code(404).send({ error: 'account not found' });
    }
    savePhotosAccounts(accounts.filter((a) => a.accountId !== req.params.id));
    removePickedForAccount(req.params.id);
    return { ok: true };
  });

  // persisted picks for an account — lets the frontend re-hydrate on mount instead of losing everything
  // the moment the Google Photos view unmounts (or the app restarts).
  app.get<{ Params: { id: string } }>('/photos/:id/media', async (req, reply) => {
    const account = loadPhotosAccounts().find((a) => a.accountId === req.params.id);
    if (!account) return reply.code(404).send({ error: 'account not found' });
    return { items: getPickedItems(req.params.id) };
  });

  // "Remove" — unpicks one item. Doesn't touch the photo in the user's actual Google Photos library.
  app.delete<{ Params: { id: string; itemId: string } }>('/photos/:id/media/:itemId', async (req, reply) => {
    const account = loadPhotosAccounts().find((a) => a.accountId === req.params.id);
    if (!account) return reply.code(404).send({ error: 'account not found' });
    return { items: removePickedItem(req.params.id, req.params.itemId) };
  });

  // "Open In App" — downloads the full-quality original to a temp file and hands it to macOS's normal
  // open-with-default-app flow, same as opening a file from any other cloud.
  app.post<{ Params: { id: string }; Body: { baseUrl: string; filename: string } }>(
    '/photos/:id/open',
    async (req, reply) => {
      const account = loadPhotosAccounts().find((a) => a.accountId === req.params.id);
      if (!account) return reply.code(404).send({ error: 'account not found' });
      const creds = requireGoogleCreds(reply);
      if (!creds) return;
      const { baseUrl, filename } = req.body;
      if (!baseUrl || !filename) return reply.code(400).send({ error: 'missing baseUrl/filename' });

      try {
        const token = await getAccessToken(account.accountId, account.refreshToken, creds.clientId, creds.clientSecret);
        const res = await fetch(`${baseUrl}=d`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('failed to download photo');

        const buf = Buffer.from(await res.arrayBuffer());
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alliminate-photo-'));
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, buf);

        openLocalFile(filePath, undefined, (err) => app.log.error(err, 'failed to open photo'));
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // starts a new Picker session — the frontend opens `pickerUri` in the real browser and the user
  // selects photos/videos there, in Google's own UI.
  app.post<{ Params: { id: string } }>('/photos/:id/picker/session', async (req, reply) => {
    const account = loadPhotosAccounts().find((a) => a.accountId === req.params.id);
    if (!account) return reply.code(404).send({ error: 'account not found' });
    const creds = requireGoogleCreds(reply);
    if (!creds) return;

    try {
      const token = await getAccessToken(account.accountId, account.refreshToken, creds.clientId, creds.clientSecret);
      const res = await fetch(`${PICKER_API}/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'failed to start picker session');

      return {
        sessionId: data.id,
        pickerUri: data.pickerUri,
        pollIntervalMs: Math.round(Number(data.pollingConfig?.pollInterval?.replace('s', '') ?? '2') * 1000),
      };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // poll until the user finishes picking in the browser.
  app.get<{ Params: { id: string; sessionId: string } }>(
    '/photos/:id/picker/session/:sessionId',
    async (req, reply) => {
      const account = loadPhotosAccounts().find((a) => a.accountId === req.params.id);
      if (!account) return reply.code(404).send({ error: 'account not found' });
      const creds = requireGoogleCreds(reply);
      if (!creds) return;

      try {
        const token = await getAccessToken(account.accountId, account.refreshToken, creds.clientId, creds.clientSecret);
        const res = await fetch(`${PICKER_API}/sessions/${req.params.sessionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? 'failed to poll picker session');
        return { mediaItemsSet: !!data.mediaItemsSet };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // once mediaItemsSet is true, fetch what the user actually picked.
  app.get<{ Params: { id: string; sessionId: string } }>(
    '/photos/:id/picker/session/:sessionId/items',
    async (req, reply) => {
      const account = loadPhotosAccounts().find((a) => a.accountId === req.params.id);
      if (!account) return reply.code(404).send({ error: 'account not found' });
      const creds = requireGoogleCreds(reply);
      if (!creds) return;

      try {
        const token = await getAccessToken(account.accountId, account.refreshToken, creds.clientId, creds.clientSecret);

        // mediaItems.list is paginated (100/page) — a 1000+ item pick needs the full walk, not just page one.
        const rawItems: any[] = [];
        let pageToken: string | undefined;
        do {
          const qs = new URLSearchParams({ sessionId: req.params.sessionId, pageSize: '100' });
          if (pageToken) qs.set('pageToken', pageToken);
          const res = await fetch(`${PICKER_API}/mediaItems?${qs.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error?.message ?? 'failed to fetch picked items');
          rawItems.push(...(data.mediaItems ?? []));
          pageToken = data.nextPageToken ?? undefined;
        } while (pageToken);

        const items = rawItems.map((entry: any) => {
          const item = entry.mediaFile ?? entry;
          return {
            id: entry.id,
            baseUrl: item.baseUrl,
            filename: item.filename,
            mimeType: item.mimeType,
            isVideo: (item.mimeType ?? '').startsWith('video/'),
            creationTime: item.mediaFileMetadata?.creationTime ?? entry.createTime,
            width: Number(item.mediaFileMetadata?.width ?? 0),
            height: Number(item.mediaFileMetadata?.height ?? 0),
          };
        });

        // persist so the picks survive leaving the tab / restarting the app, not just this response.
        const allForAccount = addPickedItems(account.accountId, items);

        // best-effort cleanup — the session's done its job once we've read the picks.
        fetch(`${PICKER_API}/sessions/${req.params.sessionId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});

        return { items: allForAccount };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Picker API baseUrls need an Authorization header to fetch bytes (unlike the old Library API's
  // directly-fetchable signed URLs) — the browser <img> tag can't set headers, so proxy it.
  app.get<{ Params: { id: string }; Querystring: { url: string; w?: string; h?: string; download?: string; filename?: string } }>(
    '/photos/:id/thumbnail',
    async (req, reply) => {
      const account = loadPhotosAccounts().find((a) => a.accountId === req.params.id);
      if (!account) return reply.code(404).send({ error: 'account not found' });
      const creds = requireGoogleCreds(reply);
      if (!creds) return;
      if (!req.query.url) return reply.code(400).send({ error: 'missing url' });

      try {
        const token = await getAccessToken(account.accountId, account.refreshToken, creds.clientId, creds.clientSecret);
        // "=d" is Google's full-quality download suffix — everything else is a resized preview crop.
        const suffix = req.query.download ? '=d' : `=w${req.query.w ?? '300'}-h${req.query.h ?? '300'}-c`;
        const res = await fetch(`${req.query.url}${suffix}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return reply.code(res.status).send({ error: 'failed to fetch thumbnail' });

        const buf = Buffer.from(await res.arrayBuffer());
        reply.header('Content-Type', res.headers.get('content-type') ?? 'image/jpeg');
        if (req.query.download) {
          reply.header('Content-Disposition', `attachment; filename="${(req.query.filename ?? 'photo').replace(/[^\w.-]+/g, '_')}"`);
        } else {
          reply.header('Cache-Control', 'private, max-age=3600');
        }
        return reply.send(buf);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Google Photos items live behind the Picker API's baseUrl, not the StorageBackend.get() interface every
  // other provider uses — these two mirror /files/send-to-device and /files/send-nearby exactly, just
  // sourcing bytes via fetchPhotoBytes instead of a StorageBackend.
  app.post<{ Params: { id: string }; Body: { baseUrl: string; filename: string; deviceId: string } }>(
    '/photos/:id/send-to-device',
    async (req, reply) => {
      const { baseUrl, filename, deviceId } = req.body;
      if (!baseUrl || !filename || !deviceId) return reply.code(400).send({ error: 'missing baseUrl, filename, or deviceId' });

      const peer = loadPairedDevices().find((d) => d.id === deviceId);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });

      try {
        const data = await fetchPhotoBytes(req.params.id, baseUrl);
        const statusRes = await fetch(`http://${peer.host}/status`, { headers: { Authorization: `Bearer ${peer.token}` } });
        if (!statusRes.ok) return reply.code(502).send({ error: 'device unreachable' });
        const statusData = await statusRes.json();
        const destFolderId = statusData.folders?.[0]?.id;
        if (!destFolderId) return reply.code(502).send({ error: 'device has no folder to receive into' });

        const from = getDeviceIdentity().name;
        const uploadRes = await fetch(
          `http://${peer.host}/folders/${destFolderId}/upload?name=${encodeURIComponent(filename)}&from=${encodeURIComponent(from)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${peer.token}` }, body: new Uint8Array(data) },
        );
        if (!uploadRes.ok) return reply.code(502).send({ error: 'device rejected the file' });
        logTransfer({ deviceId: peer.id, deviceName: peer.name, fileName: filename, direction: 'sent', size: data.length, path: `${destFolderId}/${filename}` });
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { baseUrl: string; filename: string; peerId: string } }>(
    '/photos/:id/send-nearby',
    async (req, reply) => {
      const { baseUrl, filename, peerId } = req.body;
      if (!baseUrl || !filename || !peerId) return reply.code(400).send({ error: 'missing baseUrl, filename, or peerId' });

      const peer = getNearbyPeers().find((p) => p.id === peerId);
      if (!peer) return reply.code(404).send({ error: 'that device is no longer nearby' });

      try {
        const data = await fetchPhotoBytes(req.params.id, baseUrl);
        const result = await sendBytesToNearbyPeer(peer, filename, data);
        if (!result.ok && result.status === 'unreachable') return reply.code(502).send({ error: result.error ?? 'device unreachable' });
        return result;
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  let photosServer: http.Server | null = null;
  let photosTimeout: ReturnType<typeof setTimeout> | null = null;

  app.post('/photos/connect', async (_req, reply) => {
    if (photosServer) {
      photosServer.close();
      photosServer = null;
    }
    if (photosTimeout) clearTimeout(photosTimeout);

    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ error: 'missing GOOGLE_DRIVE_CLIENT_ID/SECRET in .env — set those up first' });
    }

    const existing = loadPhotosAccounts();
    if (existing.length >= 7) {
      return reply.code(400).send({ error: 'already at the 7-account limit for Google Photos' });
    }

    const redirectUri = `http://127.0.0.1:${PHOTOS_OAUTH_PORT}/oauth/callback`;
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code` +
      `&access_type=offline&prompt=consent&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(PHOTOS_SCOPE)}`;

    photosServer = http.createServer(async (httpReq, httpRes) => {
      if (!httpReq.url?.startsWith('/oauth/callback')) {
        httpRes.writeHead(404);
        httpRes.end();
        return;
      }

      const url = new URL(httpReq.url, redirectUri);
      const code = url.searchParams.get('code');

      try {
        if (!code) throw new Error(url.searchParams.get('error_description') ?? 'missing code');

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.refresh_token) {
          throw new Error(
            tokenData.error_description ?? 'no refresh_token returned — revoke prior access at https://myaccount.google.com/permissions and retry',
          );
        }

        let email = 'Google Photos account';
        try {
          const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          const info = await infoRes.json();
          email = info.email ?? email;
        } catch {
          // non-fatal — generic label if the email lookup fails
        }

        const accounts = loadPhotosAccounts();
        const already = accounts.find((a) => a.email === email);
        if (already) {
          // re-consent for an already-linked account (e.g. to pick up a newly-authorized scope) —
          // update its token in place instead of refusing.
          already.refreshToken = tokenData.refresh_token;
        } else {
          const accountId = nextPhotosAccountId(accounts);
          accounts.push({ accountId, label: email, email, refreshToken: tokenData.refresh_token });
        }
        savePhotosAccounts(accounts);

        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end(`<h2>AllieMinate linked ${email} for Google Photos.</h2><p>You can close this tab.</p>`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        httpRes.writeHead(500);
        httpRes.end('token exchange failed — check the AllieMinate backend terminal');
      } finally {
        if (photosTimeout) clearTimeout(photosTimeout);
        photosServer?.close();
        photosServer = null;
      }
    });

    photosServer.listen(PHOTOS_OAUTH_PORT, () => {
      try {
        openExternalUrl(authUrl);
      } catch {
        // couldn't auto-open — the frontend still has the authUrl to show
      }
    });

    photosTimeout = setTimeout(() => {
      photosServer?.close();
      photosServer = null;
    }, 5 * 60 * 1000);

    return { ok: true, status: 'pending', authUrl };
  });
}
