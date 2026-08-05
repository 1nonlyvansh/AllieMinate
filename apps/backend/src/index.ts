import { config } from './config';
import { buildStorageBackends } from './storage';
import { buildServer } from './api/server';
import { loadFolders, backfillDriveLibraryFolders } from './sync/folders';
import { SyncEngine, bootstrapSyncPairs } from './sync/engine';
import { cleanupRemoteCache } from './remoteCache';
import { startNearbyDiscovery } from './nearbyDiscovery';
import { purgeOldSyncTrash } from './sync/syncTrash';
import { recordAutomatedLog } from './logs';

const SYNC_TRASH_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Without this, ANY unhandled rejection ANYWHERE in the backend (a cloud API call that rejects outside a
// try/catch, a fire-and-forget promise nobody attached a .catch to) took down the entire Node process —
// the desktop's auto-restart (index.ts main process) papers over the outage but every in-flight request
// still gets dropped and the app briefly goes "backend unreachable." Log and keep running instead; a
// single bad promise shouldn't be worth a full crash-and-respawn cycle.
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection', reason);
  recordAutomatedLog(`Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});
process.on('uncaughtException', (err) => {
  console.error('uncaught exception', err);
  recordAutomatedLog(`Uncaught exception: ${err.stack ?? err.message}`);
});

async function main(): Promise<void> {
  const backends = buildStorageBackends();
  console.log(`storage backends ready: ${Array.from(backends.keys()).join(', ') || 'none'}`);

  // wipe any temp cross-cloud copies left over from a previous session's online-editor opens.
  cleanupRemoteCache(backends).catch((err) => console.error('remote cache cleanup failed', err));

  // Sync Trash retention sweep — same startup-then-interval shape as the remote cache cleanup above.
  purgeOldSyncTrash().catch((err) => console.error('sync trash purge failed', err));
  setInterval(() => purgeOldSyncTrash().catch((err) => console.error('sync trash purge failed', err)), SYNC_TRASH_PURGE_INTERVAL_MS);

  let folders = loadFolders();
  const driveProviderIds = Array.from(backends.keys()).filter((id) => id === 'google-drive' || id.startsWith('google-drive:'));
  folders = backfillDriveLibraryFolders(folders, driveProviderIds);
  console.log(`folders loaded: ${folders.map((f) => f.name).join(', ') || 'none'}`);

  new SyncEngine(folders, backends).start();
  bootstrapSyncPairs(backends);

  const server = await buildServer(backends, folders);
  await server.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`alliminate backend listening on :${config.port} (LAN-reachable)`);

  startNearbyDiscovery(config.port);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
