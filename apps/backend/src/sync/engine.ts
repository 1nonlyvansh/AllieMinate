import path from 'node:path';
import fs from 'node:fs/promises';
import type { FSWatcher } from 'chokidar';
import type { FolderConfig, SyncPair } from '@alliminate/shared';
import type { StorageBackend } from '../storage/StorageBackend';
import { watchFolder, WatchEvent } from '../watcher';
import { emitSyncEvent } from '../events';
import { loadPairedDevices } from '../pairing';
import { asSyncTarget, DeviceSyncTarget, SyncTarget } from './syncTarget';
import { reconcileFolder, recordLocalSync } from './twoWaySync';
import { isIgnored } from './ignoreRules';
import { hashBuffer } from './fileHash';
import { maxFileSizeFor } from './syncSafety';
import { throttle } from './bandwidthThrottle';
import { listSyncPairs } from './syncPairs';

// Auto-Sync folders get a reconciliation pass this often — the local side already propagates near-
// instantly via the chokidar watcher below, this interval is purely for noticing REMOTE changes, since a
// cloud account or paired device has no way to push "something changed" to us on its own.
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000;

function resolveSyncTarget(folder: FolderConfig, backend: StorageBackend | undefined): SyncTarget | null {
  if (folder.syncTargetKind !== 'device') return backend ? asSyncTarget(backend) : null;
  if (!folder.syncDeviceId || !folder.syncDeviceFolderId) return null;
  const peer = loadPairedDevices().find((d) => d.id === folder.syncDeviceId);
  if (!peer) return null;
  return new DeviceSyncTarget(peer, folder.syncDeviceFolderId, peer.platform === 'android', folder.syncDeviceFolderKind ?? 'folder');
}

// One interval per folder, tracked so it can actually be torn down again — without this, disabling
// Auto-Sync (or re-enabling it against a different target) would leave the OLD interval running forever,
// reconciling a folder that's supposedly off, exactly the "leaked periodic task" shape that's caused real
// hammering bugs elsewhere in this app.
const activeIntervals = new Map<string, ReturnType<typeof setInterval>>();

// Distinct from a full disable — pause stops the interval but keeps everything else (sync state, ignore
// rules, the folder's own autoSync flag) intact, so resume just restarts the interval rather than treating
// the folder as brand new (which would otherwise re-run the phantom-conflict-prone "no baseline" path).
const pausedFolderIds = new Set<string>();

// A slow reconciliation pass (many files, a slow provider like MEGA) can take longer than
// RECONCILE_INTERVAL_MS to finish — without this guard, the interval's next tick starts a SECOND
// reconcileFolder call for the same folder while the first is still mid-flight. Both load the same
// on-disk sync state (neither has saved yet), both see the same files as "not yet recorded," and both
// push them — the exact duplicate-upload bug this was built to catch (confirmed live: MEGA doesn't
// enforce unique filenames, so two concurrent passes each doing their own findFile-miss → upload produced
// two separate files with the same name instead of one being overwritten). saveSyncState() at the end of
// each pass also only reflects that one pass's view, so a second concurrent pass finishing after can
// silently drop whatever the first one recorded — a second, related lost-update bug from the same root cause.
const reconcilingIds = new Set<string>();

async function reconcileOnce(folder: FolderConfig, target: SyncTarget): Promise<void> {
  if (reconcilingIds.has(folder.id)) {
    console.warn(`Auto-Sync reconciliation for "${folder.name}" is still running — skipping this tick`);
    return;
  }
  reconcilingIds.add(folder.id);
  try {
    await reconcileFolder(folder, target);
  } finally {
    reconcilingIds.delete(folder.id);
  }
}

export function stopAutoSyncForFolder(folderId: string): void {
  const existing = activeIntervals.get(folderId);
  if (existing) {
    clearInterval(existing);
    activeIntervals.delete(folderId);
  }
}

export function isSyncPaused(folderId: string): boolean {
  return pausedFolderIds.has(folderId);
}

export function pauseAutoSyncForFolder(folderId: string): void {
  stopAutoSyncForFolder(folderId);
  pausedFolderIds.add(folderId);
}

export function resumeAutoSyncForFolder(folder: FolderConfig, backend: StorageBackend | undefined): void {
  pausedFolderIds.delete(folder.id);
  startAutoSyncForFolder(folder, backend);
}

// Shared by SyncEngine.start() (folders that already have autoSync at boot) and the /folders/:id/auto-sync
// route (a folder toggled on mid-session) — an initial pass so the user sees a sync happen right away,
// then an ongoing interval for noticing remote-side changes. Re-resolves the target on every tick rather
// than once, since a paired device's host can drift (DHCP lease renewal) same as every other device route.
export function startAutoSyncForFolder(folder: FolderConfig, backend: StorageBackend | undefined): void {
  stopAutoSyncForFolder(folder.id); // guard against double-starting (e.g. the enable route called twice)
  const target = resolveSyncTarget(folder, backend);
  if (!target) {
    console.warn(`Auto-Sync folder "${folder.name}" has no reachable target — skipping reconciliation`);
    return;
  }
  reconcileOnce(folder, target).catch((err) => console.error(`initial Auto-Sync reconciliation failed for "${folder.name}"`, err));
  const interval = setInterval(() => {
    const liveTarget = resolveSyncTarget(folder, backend);
    if (liveTarget) reconcileOnce(folder, liveTarget).catch((err) => console.error(`Auto-Sync reconciliation failed for "${folder.name}"`, err));
  }, RECONCILE_INTERVAL_MS);
  activeIntervals.set(folder.id, interval);
}

// The always-on local→remote push, extracted to module scope (was a SyncEngine private method) so it's
// reusable for freestanding Sync Pairs too — a pair adapted to FolderConfig shape goes through the exact
// same push/record/emit path as a pinned folder, no separate code path to keep in sync. Takes a SyncTarget
// rather than a full StorageBackend — this function only ever calls .put/.delete, both already part of
// SyncTarget's contract, so a device-target pair's live watcher can push through a DeviceSyncTarget the
// exact same way a cloud-target pair pushes through its StorageBackend (every StorageBackend already
// structurally satisfies SyncTarget, so every existing call site keeps working unchanged).
async function syncFolderEvent(folder: FolderConfig, backend: SyncTarget, event: WatchEvent): Promise<void> {
  // 'download-only' never pushes anything local→remote, live watcher included — the whole point is this
  // folder only ever receives. 'backup-only' still pushes content (that's the backup), it just never lets
  // a local delete propagate as a remote delete, so the "backup" can't be wiped out by a local mistake.
  if (folder.direction === 'download-only') return;
  if (folder.direction === 'backup-only' && event.type === 'unlink') return;

  const relPath = path.relative(folder.localPath, event.path).split(path.sep).join('/');
  // watchFolder forwards every raw chokidar event with no filtering — reconcileFolder's periodic pass
  // already skips dotfiles/ignore-rule matches, but this always-on live path never did, so Finder simply
  // touching .DS_Store while you browse the folder pushed a "sync" every time. Same skip, same rule, here.
  const baseName = relPath.split('/').pop() ?? relPath;
  if (baseName.startsWith('.') || isIgnored(baseName)) return;
  const key = path.posix.join(folder.remotePrefix, relPath);

  try {
    if (event.type === 'unlink') {
      await backend.delete(key);
      console.log(`deleted ${key}`);
      if (folder.autoSync) recordLocalSync(folder.id, relPath, 0, '', true);
      emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key, deleted: true } });
    } else {
      const data = await fs.readFile(event.path);
      const max = maxFileSizeFor(folder.provider);
      if (data.length > max) {
        throw new Error(`file is ${(data.length / 1024 ** 3).toFixed(1)}GB, over the ${(max / 1024 ** 3).toFixed(0)}GB limit for this provider — not uploaded`);
      }
      await throttle(data.length);
      await backend.put(key, data);
      console.log(`synced ${key} (${data.length}b)`);
      if (folder.autoSync) {
        const stat = await fs.stat(event.path);
        recordLocalSync(folder.id, relPath, stat.size, stat.mtime.toISOString(), false, hashBuffer(data) ?? undefined);
      }
      emitSyncEvent({
        type: 'file-synced',
        folderId: folder.id,
        payload: { key, size: data.length },
      });
    }
  } catch (err) {
    console.error(`sync failed for ${key}`, err);
    emitSyncEvent({
      type: 'error',
      folderId: folder.id,
      payload: { key, message: err instanceof Error ? err.message : String(err) },
    });
  }
}

export class SyncEngine {
  constructor(
    private folders: FolderConfig[],
    private backends: Map<string, StorageBackend>,
  ) {}

  start(): void {
    for (const folder of this.folders) {
      const backend = this.backends.get(folder.provider);
      if (!backend) {
        console.warn(`skip folder "${folder.name}": provider ${folder.provider} not configured`);
        continue;
      }
      if (folder.remotePrefix === '*' || !folder.localPath) {
        console.log(`"${folder.name}" has no local path to watch — upload-only`);
        continue;
      }
      watchFolder(folder.localPath, (event) => syncFolderEvent(folder, backend, event));

      // initial pass catches anything that changed while the app was closed (the watcher's
      // ignoreInitial:true means it only ever sees changes from this moment forward on its own).
      if (folder.autoSync) startAutoSyncForFolder(folder, backend);
    }
  }
}

// --- Sync Engine (Phase 3): freestanding Sync Pairs, decoupled from the pinned-folder model above ---
// A SyncPair covers everything a FolderConfig with autoSync=true already knows how to do (push watcher +
// two-way reconciliation) — rather than a second parallel implementation, it's adapted into the exact same
// shape and run through the exact same functions above. `direction` isn't enforced yet (every pair behaves
// as two-way regardless of the chosen setting) — that's explicitly the later "direction control" phase;
// this ships the data model, the CRUD routes, and the engine wiring first.
function syncPairToFolderLike(pair: SyncPair): FolderConfig {
  return {
    id: pair.id,
    name: pair.name,
    localPath: pair.localPath,
    provider: pair.providerId ?? '',
    remotePrefix: pair.remotePath,
    pinned: false,
    autoSync: true,
    syncTargetKind: pair.targetKind,
    syncDeviceId: pair.deviceId,
    syncDeviceFolderId: pair.deviceFolderId,
    syncDeviceFolderKind: pair.deviceFolderKind,
    direction: pair.direction,
  };
}

const activePairWatchers = new Map<string, FSWatcher>();

export function startSyncPair(pair: SyncPair, backends: Map<string, StorageBackend>): void {
  stopSyncPairWatch(pair.id); // guard against double-starting

  const folder = syncPairToFolderLike(pair);

  if (pair.targetKind === 'device') {
    // no home cloud account here — the live watcher pushes straight through a DeviceSyncTarget instead
    // of a StorageBackend (syncFolderEvent accepts either, see its own comment). resolveSyncTarget is the
    // same helper Auto-Sync's periodic reconciliation already uses for a device target, reused here so
    // there's exactly one place that knows how to turn (peer id, remote folder id/kind) into a live target.
    const target = resolveSyncTarget(folder, undefined);
    if (!target) {
      console.warn(`Sync Pair "${pair.name}" — paired device ${pair.deviceId} not reachable, skipping`);
      return;
    }
    const watcher = watchFolder(pair.localPath, (event) => syncFolderEvent(folder, target, event));
    activePairWatchers.set(pair.id, watcher);
    startAutoSyncForFolder(folder, undefined);
    return;
  }

  const backend = backends.get(pair.providerId ?? '');
  if (!backend) {
    console.warn(`Sync Pair "${pair.name}" — provider ${pair.providerId} not configured, skipping`);
    return;
  }
  const watcher = watchFolder(pair.localPath, (event) => syncFolderEvent(folder, backend, event));
  activePairWatchers.set(pair.id, watcher);
  startAutoSyncForFolder(folder, backend);
}

export function stopSyncPairWatch(pairId: string): void {
  const watcher = activePairWatchers.get(pairId);
  if (watcher) {
    watcher.close().catch(() => {});
    activePairWatchers.delete(pairId);
  }
  stopAutoSyncForFolder(pairId);
}

/** Called once at backend startup — mirrors SyncEngine.start()'s job but for pairs that live outside the
 * pinned-folder list entirely. */
export function bootstrapSyncPairs(backends: Map<string, StorageBackend>): void {
  for (const pair of listSyncPairs()) {
    if (pair.status !== 'active') continue;
    startSyncPair(pair, backends);
  }
}
