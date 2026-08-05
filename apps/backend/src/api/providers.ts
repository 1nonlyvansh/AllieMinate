import type { FastifyInstance } from 'fastify';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { google } from 'googleapis';
import type { FolderConfig, StorageProviderId } from '@alliminate/shared';
import type { StorageBackend } from '../storage/StorageBackend';
import { S3CompatibleBackend } from '../storage/S3CompatibleBackend';
import { MegaBackend } from '../storage/MegaBackend';
import { GoogleDriveBackend } from '../storage/GoogleDriveBackend';
import { PCloudBackend } from '../storage/PCloudBackend';
import { OneDriveBackend } from '../storage/OneDriveBackend';
import { updateEnv } from '../env';
import { emitSyncEvent } from '../events';
import { loadDriveAccounts, saveDriveAccounts, nextDriveAccountId } from '../accounts';
import { saveFolders } from '../sync/folders';
import { config } from '../config';
import { setProviderDisabled } from '../disabledProviders';
import { startAutoSyncForFolder, stopAutoSyncForFolder, pauseAutoSyncForFolder, resumeAutoSyncForFolder, isSyncPaused } from '../sync/engine';
import { deleteSyncState } from '../sync/syncState';
import { loadIgnoreRules, saveIgnoreRules } from '../sync/ignoreRules';
import { loadPairedDevices } from '../pairing';

interface S3EnvKeys {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const S3_ENV_KEYS: Partial<Record<StorageProviderId, S3EnvKeys>> = {
  b2: { endpoint: 'B2_ENDPOINT', region: 'B2_REGION', bucket: 'B2_BUCKET', accessKeyId: 'B2_KEY_ID', secretAccessKey: 'B2_APPLICATION_KEY' },
  'idrive-e2': { endpoint: 'IDRIVE_E2_ENDPOINT', region: 'IDRIVE_E2_REGION', bucket: 'IDRIVE_E2_BUCKET', accessKeyId: 'IDRIVE_E2_ACCESS_KEY_ID', secretAccessKey: 'IDRIVE_E2_SECRET_ACCESS_KEY' },
};

const OAUTH_PORT = 53682;
const OAUTH_ADD_ACCOUNT_PORT = 53683;
const PCLOUD_OAUTH_PORT = 53684;
const ONEDRIVE_OAUTH_PORT = 53685;

export function registerProviderRoutes(
  app: FastifyInstance,
  backends: Map<string, StorageBackend>,
  folders: FolderConfig[],
): void {
  app.post<{ Params: { id: string } }>('/providers/:id/disconnect', async (req, reply) => {
    const id = req.params.id;
    if (!backends.has(id)) return reply.code(404).send({ error: 'not connected' });

    backends.delete(id);
    // the credentials really do stay in .env/driveAccounts.json (see disabledProviders.ts) — this just
    // makes the disconnect survive a restart instead of silently reconnecting on next boot.
    setProviderDisabled(id, true);
    emitSyncEvent({ type: 'status', folderId: '', payload: { provider: id, connected: false } });
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  }>('/providers/:id/connect/s3', async (req, reply) => {
    const id = req.params.id as StorageProviderId;
    const envKeys = S3_ENV_KEYS[id];
    if (!envKeys) return reply.code(400).send({ error: 'not an S3-compatible provider' });

    const cfg = req.body;
    if (!cfg.endpoint || !cfg.region || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
      return reply.code(400).send({ error: 'missing fields' });
    }

    const backend = new S3CompatibleBackend(cfg);
    try {
      await backend.list('');
    } catch (err) {
      return reply.code(400).send({ error: `couldn't connect: ${err instanceof Error ? err.message : String(err)}` });
    }

    updateEnv({
      [envKeys.endpoint]: cfg.endpoint,
      [envKeys.region]: cfg.region,
      [envKeys.bucket]: cfg.bucket,
      [envKeys.accessKeyId]: cfg.accessKeyId,
      [envKeys.secretAccessKey]: cfg.secretAccessKey,
    });
    backends.set(id, backend);
    setProviderDisabled(id, false);
    emitSyncEvent({ type: 'status', folderId: '', payload: { provider: id, connected: true } });
    return { ok: true };
  });

  app.post<{ Body: { email: string; password: string } }>('/providers/mega/connect', async (req, reply) => {
    const { email, password } = req.body;
    if (!email || !password) return reply.code(400).send({ error: 'missing fields' });

    const backend = new MegaBackend({ email, password });
    try {
      await backend.list('');
    } catch (err) {
      return reply.code(400).send({ error: `couldn't connect: ${err instanceof Error ? err.message : String(err)}` });
    }

    updateEnv({ MEGA_EMAIL: email, MEGA_PASSWORD: password });
    backends.set('mega', backend);
    setProviderDisabled('mega', false);
    emitSyncEvent({ type: 'status', folderId: '', payload: { provider: 'mega', connected: true } });
    return { ok: true };
  });

  let oauthServer: http.Server | null = null;
  let oauthTimeout: ReturnType<typeof setTimeout> | null = null;

  app.post('/providers/google-drive/connect', async (_req, reply) => {
    // a click always restarts the flow — no way to get permanently stuck on an abandoned attempt.
    if (oauthServer) {
      oauthServer.close();
      oauthServer = null;
    }
    if (oauthTimeout) clearTimeout(oauthTimeout);

    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ error: 'missing GOOGLE_DRIVE_CLIENT_ID/SECRET in .env — set those up first' });
    }

    const redirectUri = `http://127.0.0.1:${OAUTH_PORT}/oauth/callback`;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive'],
    });

    oauthServer = http.createServer(async (httpReq, httpRes) => {
      if (!httpReq.url?.startsWith('/oauth/callback')) {
        httpRes.writeHead(404);
        httpRes.end();
        return;
      }

      const url = new URL(httpReq.url, redirectUri);
      const code = url.searchParams.get('code');

      try {
        if (!code) throw new Error('missing code');
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.refresh_token) {
          throw new Error(
            'no refresh_token returned — revoke prior access at https://myaccount.google.com/permissions and retry',
          );
        }

        updateEnv({ GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token });
        const backend = new GoogleDriveBackend({ clientId, clientSecret, refreshToken: tokens.refresh_token });
        backends.set('google-drive', backend);
        setProviderDisabled('google-drive', false);

        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end('<h2>AllieMinate connected to Google Drive.</h2><p>You can close this tab.</p>');
        emitSyncEvent({ type: 'status', folderId: '', payload: { provider: 'google-drive', connected: true } });
      } catch (err) {
        httpRes.writeHead(500);
        httpRes.end('token exchange failed — check the AllieMinate backend terminal');
        emitSyncEvent({
          type: 'error',
          folderId: '',
          payload: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        if (oauthTimeout) clearTimeout(oauthTimeout);
        oauthServer?.close();
        oauthServer = null;
      }
    });

    oauthServer.listen(OAUTH_PORT, () => {
      try {
        execSync(`open "${authUrl}"`);
      } catch {
        // couldn't auto-open — the frontend still has the authUrl to show
      }
    });

    oauthTimeout = setTimeout(() => {
      oauthServer?.close();
      oauthServer = null;
    }, 5 * 60 * 1000);

    return { ok: true, status: 'pending', authUrl };
  });

  // link an ADDITIONAL Google Drive account, alongside the primary one — up to 7, per the original spec.
  let addAccountServer: http.Server | null = null;
  let addAccountTimeout: ReturnType<typeof setTimeout> | null = null;

  app.post('/accounts/google-drive/add', async (_req, reply) => {
    if (addAccountServer) {
      addAccountServer.close();
      addAccountServer = null;
    }
    if (addAccountTimeout) clearTimeout(addAccountTimeout);

    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ error: 'missing GOOGLE_DRIVE_CLIENT_ID/SECRET in .env — set those up first' });
    }

    const existing = loadDriveAccounts();
    if (existing.length >= 6) {
      // 6 extra + the 1 primary = 7, matching the account cap the user originally asked for.
      return reply.code(400).send({ error: 'already at the 7-account limit for Google Drive' });
    }

    const redirectUri = `http://127.0.0.1:${OAUTH_ADD_ACCOUNT_PORT}/oauth/callback`;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/userinfo.email'],
    });

    addAccountServer = http.createServer(async (httpReq, httpRes) => {
      if (!httpReq.url?.startsWith('/oauth/callback')) {
        httpRes.writeHead(404);
        httpRes.end();
        return;
      }

      const url = new URL(httpReq.url, redirectUri);
      const code = url.searchParams.get('code');

      try {
        if (!code) throw new Error('missing code');
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.refresh_token) {
          throw new Error(
            'no refresh_token returned — this Google account may already be linked. Revoke prior access at https://myaccount.google.com/permissions and retry',
          );
        }
        oauth2Client.setCredentials(tokens);

        let label = 'Google Drive account';
        let email = '';
        try {
          const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
          const info = await oauth2.userinfo.get();
          email = info.data.email ?? '';
          label = email || label;
        } catch {
          // non-fatal — proceed with a generic label if the email lookup fails
        }

        const accounts = loadDriveAccounts();

        if (email && accounts.some((a) => a.email === email)) {
          throw new Error('Account already linked');
        }
        if (email && clientId && clientSecret && config.googleDrive?.refreshToken) {
          try {
            const primaryClient = new google.auth.OAuth2(clientId, clientSecret);
            primaryClient.setCredentials({ refresh_token: config.googleDrive.refreshToken });
            const primaryInfo = await google.oauth2({ version: 'v2', auth: primaryClient }).userinfo.get();
            if (primaryInfo.data.email === email) throw new Error('Account already linked');
          } catch (err) {
            if (err instanceof Error && err.message === 'Account already linked') throw err;
            // couldn't check the primary account's email — proceed rather than block linking.
          }
        }

        const accountId = nextDriveAccountId(accounts);
        accounts.push({ accountId, label, email, refreshToken: tokens.refresh_token });
        saveDriveAccounts(accounts);

        const backend = new GoogleDriveBackend({ clientId, clientSecret, refreshToken: tokens.refresh_token });
        backends.set(accountId, backend);
        setProviderDisabled(accountId, false);

        // give the new account one real, immediately-usable upload destination...
        folders.push({
          id: accountId,
          name: `${label} (Drive)`,
          localPath: '',
          provider: accountId,
          remotePrefix: 'inbox',
        });
        // ...and a whole-account read-only view, same as the primary account gets — otherwise every file
        // this account already has in Drive (outside AllieMinate's own "inbox" folder) stays invisible.
        folders.push({
          id: `${accountId}-library`,
          name: `${label} (All Files)`,
          localPath: '',
          provider: accountId,
          remotePrefix: '*',
          pinned: false,
        });
        saveFolders(folders);

        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end(`<h2>AllieMinate linked ${label}.</h2><p>You can close this tab.</p>`);
        emitSyncEvent({ type: 'status', folderId: '', payload: { provider: accountId, connected: true } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        httpRes.writeHead(message === 'Account already linked' ? 409 : 500);
        httpRes.end(
          message === 'Account already linked'
            ? '<h2>Account already linked</h2><p>This Google account is already connected to AllieMinate. You can close this tab.</p>'
            : 'token exchange failed — check the AllieMinate backend terminal',
        );
        emitSyncEvent({ type: 'error', folderId: '', payload: { message } });
      } finally {
        if (addAccountTimeout) clearTimeout(addAccountTimeout);
        addAccountServer?.close();
        addAccountServer = null;
      }
    });

    addAccountServer.listen(OAUTH_ADD_ACCOUNT_PORT, () => {
      try {
        execSync(`open "${authUrl}"`);
      } catch {
        // couldn't auto-open — the frontend still has the authUrl to show
      }
    });

    addAccountTimeout = setTimeout(() => {
      addAccountServer?.close();
      addAccountServer = null;
    }, 5 * 60 * 1000);

    return { ok: true, status: 'pending', authUrl };
  });

  let pcloudServer: http.Server | null = null;
  let pcloudTimeout: ReturnType<typeof setTimeout> | null = null;

  app.post('/providers/pcloud/connect', async (_req, reply) => {
    if (pcloudServer) {
      pcloudServer.close();
      pcloudServer = null;
    }
    if (pcloudTimeout) clearTimeout(pcloudTimeout);

    const clientId = process.env.PCLOUD_CLIENT_ID;
    const clientSecret = process.env.PCLOUD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ error: 'missing PCLOUD_CLIENT_ID/SECRET in .env — set those up first' });
    }

    const redirectUri = `http://127.0.0.1:${PCLOUD_OAUTH_PORT}/oauth/callback`;
    const authUrl = `https://my.pcloud.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;

    pcloudServer = http.createServer(async (httpReq, httpRes) => {
      if (!httpReq.url?.startsWith('/oauth/callback')) {
        httpRes.writeHead(404);
        httpRes.end();
        return;
      }

      const url = new URL(httpReq.url, redirectUri);
      const code = url.searchParams.get('code');

      try {
        if (!code) throw new Error('missing code');
        const tokenRes = await fetch(
          `https://api.pcloud.com/oauth2_token?client_id=${clientId}&client_secret=${clientSecret}&code=${code}`,
        );
        const tokenData = await tokenRes.json();
        if (tokenData.result !== 0 || !tokenData.access_token) {
          throw new Error(tokenData.error ?? 'token exchange failed');
        }

        const apiHost = tokenData.hostname ?? 'api.pcloud.com';
        updateEnv({ PCLOUD_ACCESS_TOKEN: tokenData.access_token, PCLOUD_API_HOST: apiHost });
        backends.set('pcloud', new PCloudBackend({ accessToken: tokenData.access_token, apiHost }));
        setProviderDisabled('pcloud', false);

        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end('<h2>AllieMinate connected to pCloud.</h2><p>You can close this tab.</p>');
        emitSyncEvent({ type: 'status', folderId: '', payload: { provider: 'pcloud', connected: true } });
      } catch (err) {
        httpRes.writeHead(500);
        httpRes.end('token exchange failed — check the AllieMinate backend terminal');
        emitSyncEvent({
          type: 'error',
          folderId: '',
          payload: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        if (pcloudTimeout) clearTimeout(pcloudTimeout);
        pcloudServer?.close();
        pcloudServer = null;
      }
    });

    pcloudServer.listen(PCLOUD_OAUTH_PORT, () => {
      try {
        execSync(`open "${authUrl}"`);
      } catch {
        // couldn't auto-open — the frontend still has the authUrl to show
      }
    });

    pcloudTimeout = setTimeout(() => {
      pcloudServer?.close();
      pcloudServer = null;
    }, 5 * 60 * 1000);

    return { ok: true, status: 'pending', authUrl };
  });

  let onedriveServer: http.Server | null = null;
  let onedriveTimeout: ReturnType<typeof setTimeout> | null = null;

  app.post('/providers/onedrive/connect', async (_req, reply) => {
    if (onedriveServer) {
      onedriveServer.close();
      onedriveServer = null;
    }
    if (onedriveTimeout) clearTimeout(onedriveTimeout);

    const clientId = process.env.ONEDRIVE_CLIENT_ID;
    const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ error: 'missing ONEDRIVE_CLIENT_ID/SECRET in .env — set those up first' });
    }

    const redirectUri = `http://127.0.0.1:${ONEDRIVE_OAUTH_PORT}/oauth/callback`;
    const scope = 'Files.ReadWrite offline_access User.Read';
    const authUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}` +
      `&response_type=code&response_mode=query&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;

    onedriveServer = http.createServer(async (httpReq, httpRes) => {
      if (!httpReq.url?.startsWith('/oauth/callback')) {
        httpRes.writeHead(404);
        httpRes.end();
        return;
      }

      const url = new URL(httpReq.url, redirectUri);
      const code = url.searchParams.get('code');

      try {
        if (!code) throw new Error(url.searchParams.get('error_description') ?? 'missing code');

        const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            scope,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.refresh_token) throw new Error(tokenData.error_description ?? 'token exchange failed');

        updateEnv({ ONEDRIVE_REFRESH_TOKEN: tokenData.refresh_token });
        backends.set(
          'onedrive',
          new OneDriveBackend({ clientId, clientSecret, refreshToken: tokenData.refresh_token }),
        );
        setProviderDisabled('onedrive', false);

        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end('<h2>AllieMinate connected to OneDrive.</h2><p>You can close this tab.</p>');
        emitSyncEvent({ type: 'status', folderId: '', payload: { provider: 'onedrive', connected: true } });
      } catch (err) {
        httpRes.writeHead(500);
        httpRes.end('token exchange failed — check the AllieMinate backend terminal');
        emitSyncEvent({
          type: 'error',
          folderId: '',
          payload: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        if (onedriveTimeout) clearTimeout(onedriveTimeout);
        onedriveServer?.close();
        onedriveServer = null;
      }
    });

    onedriveServer.listen(ONEDRIVE_OAUTH_PORT, () => {
      try {
        execSync(`open "${authUrl}"`);
      } catch {
        // couldn't auto-open — the frontend still has the authUrl to show
      }
    });

    onedriveTimeout = setTimeout(() => {
      onedriveServer?.close();
      onedriveServer = null;
    }, 5 * 60 * 1000);

    return { ok: true, status: 'pending', authUrl };
  });

  // Phase 5: Auto-Sync — upgrades an existing folder (must already have a localPath, i.e. already
  // watchable) with real two-way sync. Mutates the SAME FolderConfig object already captured by every
  // other route/the running SyncEngine's watcher closures (folders is passed around by reference
  // everywhere), so this takes effect immediately without needing an app restart.
  app.post<{
    Params: { id: string };
    Body: { targetKind: 'cloud' } | { targetKind: 'device'; deviceId: string; deviceFolderId: string };
  }>('/folders/:id/auto-sync', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    if (!folder.localPath) return reply.code(409).send({ error: 'this folder has no local path to sync — pinned/library folders can\'t Auto-Sync' });

    const body = req.body;
    if (body.targetKind === 'device') {
      const peer = loadPairedDevices().find((d) => d.id === body.deviceId);
      if (!peer) return reply.code(404).send({ error: 'device not paired' });
      folder.syncTargetKind = 'device';
      folder.syncDeviceId = body.deviceId;
      folder.syncDeviceFolderId = body.deviceFolderId;
    } else {
      folder.syncTargetKind = 'cloud';
      folder.syncDeviceId = undefined;
      folder.syncDeviceFolderId = undefined;
    }
    folder.autoSync = true;
    saveFolders(folders);

    const backend = backends.get(folder.provider);
    if (backend) startAutoSyncForFolder(folder, backend);

    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/folders/:id/auto-sync/disable', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    folder.autoSync = false;
    folder.syncTargetKind = undefined;
    folder.syncDeviceId = undefined;
    folder.syncDeviceFolderId = undefined;
    saveFolders(folders);
    stopAutoSyncForFolder(folder.id);
    // drop the baseline so the NEXT toggle-on starts clean rather than reusing stale state from a
    // possibly-different target (the user could re-enable against a different device or account).
    deleteSyncState(folder.id);
    return { ok: true };
  });

  // Pause keeps the folder's autoSync flag, target, and sync baseline exactly as-is — only the interval
  // stops. Distinct from disable (above), which tears the baseline down so a future re-enable starts
  // clean. Pause is for "stop syncing for a while," disable is for "unconfigure this."
  app.post<{ Params: { id: string } }>('/folders/:id/auto-sync/pause', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    if (!folder.autoSync) return reply.code(409).send({ error: 'Auto-Sync is not on for this folder' });
    pauseAutoSyncForFolder(folder.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/folders/:id/auto-sync/resume', async (req, reply) => {
    const folder = folders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    if (!folder.autoSync) return reply.code(409).send({ error: 'Auto-Sync is not on for this folder' });
    const backend = backends.get(folder.provider);
    if (!backend) return reply.code(409).send({ error: 'provider not reachable' });
    resumeAutoSyncForFolder(folder, backend);
    return { ok: true };
  });

  app.get('/sync/ignore-rules', async () => ({ rules: loadIgnoreRules() }));

  app.post<{ Body: { rules: string[] } }>('/sync/ignore-rules', async (req, reply) => {
    if (!Array.isArray(req.body?.rules) || !req.body.rules.every((r) => typeof r === 'string')) {
      return reply.code(400).send({ error: 'rules must be a string array' });
    }
    saveIgnoreRules(req.body.rules);
    return { ok: true };
  });
}
