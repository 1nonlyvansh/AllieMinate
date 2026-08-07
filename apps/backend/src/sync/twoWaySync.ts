import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { FolderConfig, FileEntry } from '@alliminate/shared';
import type { SyncTarget } from './syncTarget';
import { loadSyncState, saveSyncState, FolderSyncState, FileSyncRecord } from './syncState';
import { isIgnored } from './ignoreRules';
import { hashFile, hashBuffer } from './fileHash';
import { trashLocalFile, trashRemoteBytes } from './syncTrash';
import { emitSyncEvent } from '../events';
import { maxFileSizeFor, estimateQuota, freeDiskSpace } from './syncSafety';
import { throttle } from './bandwidthThrottle';
import { getDeviceIdentity } from '../device';

function assertFileSizeOk(folder: FolderConfig, size: number): void {
  const max = maxFileSizeFor(folder.provider);
  if (size > max) {
    throw new Error(`file is ${(size / 1024 ** 3).toFixed(1)}GB, over the ${(max / 1024 ** 3).toFixed(0)}GB limit for this provider — not uploaded`);
  }
}

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface SyncProgress {
  done: number;
  total: number;
  active: boolean;
  startedAt: string;
}

// Live progress for whatever reconciliation pass is currently running against a given folder/pair —
// surfaced through GET /sync/pairs so the UI can show a real "(51% Done) 23/45 Files" bar instead of just
// the static all-time synced count. One entry per folder id, overwritten each pass; not persisted, this is
// purely an in-memory "what's happening right now" signal.
const progressByFolder = new Map<string, SyncProgress>();

export function getSyncProgress(folderId: string): SyncProgress | undefined {
  return progressByFolder.get(folderId);
}

interface LocalFileInfo {
  absPath: string;
  size: number;
  modifiedAt: string;
}

async function walkLocal(root: string): Promise<Map<string, LocalFileInfo>> {
  const out = new Map<string, LocalFileInfo>();
  async function walk(dir: string, relPrefix: string): Promise<void> {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // folder moved/deleted out from under us — reconciliation just sees it as empty this pass
    }
    for (const entry of entries) {
      // dotfiles are excluded unconditionally (not user-editable — same as before this file gained a real
      // ignore-rules list); the user-editable pattern list layers on top via isIgnored().
      if (entry.name.startsWith('.') || isIgnored(entry.name)) continue;
      // symlinks: Dirent.isDirectory()/isFile() already report false for a symlink (they reflect the link
      // entry itself, not its target), so this never actually followed one — but that was incidental, not
      // a deliberate choice, so it's made explicit here: a symlink into who-knows-where (possibly outside
      // this folder tree entirely, possibly a loop back into it) is never something safe to silently walk.
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const stat = await fs.stat(abs);
        out.set(rel, { absPath: abs, size: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
    }
  }
  await walk(root, '');
  return out;
}

function conflictName(relPath: string, whoLost: 'local' | 'remote'): string {
  const ext = path.extname(relPath);
  const base = relPath.slice(0, relPath.length - ext.length);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base} (${whoLost} conflict ${stamp})${ext}`;
}

// Size + modified-time is the cheap first-pass heuristic every mainstream sync client uses. A real hash is
// layered on top in reconcileOne (not here) when it's actually available for free — this function alone
// still can't tell "genuinely changed" from "same content, touched mtime" without reading the file, which
// is exactly what the hash check right after this one in reconcileOne is for.
function changed(current: { size: number; modifiedAt: string } | undefined, baseline: { size?: number; modifiedAt?: string } | undefined): boolean {
  if (!current) return false;
  if (!baseline || baseline.size === undefined || baseline.modifiedAt === undefined) return true;
  return current.size !== baseline.size || current.modifiedAt !== baseline.modifiedAt;
}

async function reconcileOne(
  folder: FolderConfig,
  target: SyncTarget,
  state: FolderSyncState,
  relPath: string,
  local: LocalFileInfo | undefined,
  remote: FileEntry | undefined,
): Promise<void> {
  const record = state[relPath];
  const localAbsPath = path.join(folder.localPath!, relPath);
  const remoteKey = path.posix.join(folder.remotePrefix, relPath);
  // 'two-way' (or unset, for every pre-existing pinned folder) is the original behavior below, unchanged.
  // 'backup-only': local is the master copy — always push local content up, never pull remote content
  // down, never let a remote-side change (including a remote delete) affect the local file at all.
  // 'download-only': the mirror of that — never push local content, only ever pull remote down.
  const direction = folder.direction ?? 'two-way';

  if (!local && !remote) {
    delete state[relPath];
    return;
  }

  let localChanged = changed(local, record ? { size: record.localSize, modifiedAt: record.localModifiedAt } : undefined);
  let remoteChanged = changed(
    remote ? { size: remote.size, modifiedAt: remote.modifiedAt } : undefined,
    record ? { size: record.remoteSize, modifiedAt: record.remoteModifiedAt } : undefined,
  );

  // The size+mtime check just flagged "remote changed" — but for a provider that gives us a real content
  // hash (Drive's md5Checksum, S3's ETag), a hash match against the stored baseline is more trustworthy
  // than modifiedAt: we never actually recorded the provider's OWN post-upload timestamp after a push
  // (below, both push branches record remoteModifiedAt as a copy of the local file's mtime, an assumption,
  // not what the server actually reports back) — if Drive's real modifiedTime drifts even slightly from
  // that guess, every future pass sees "remote changed," pulls it down, rewrites the local file (touching
  // ITS mtime too), which then looks like a local change next pass, and the two sides ping-pong forever
  // even though the content was never actually different. Hash agreement is the ground truth; a mismatched
  // timestamp on genuinely identical content doesn't mean anything actually changed.
  if (remoteChanged && remote?.hash && record?.remoteHash && remote.hash === record.remoteHash) {
    remoteChanged = false;
  }

  // Providers that never report a content hash (MEGA, OneDrive, pCloud — remote.hash is always '') leave
  // the check above unable to ever fire, so remoteModifiedAt drift (our own guessed value from the last
  // push vs whatever timestamp the provider actually reports back) looked like a real remote change on
  // every single pass forever — confirmed live: a MEGA-backed pair re-"synced" the same untouched file
  // every 2 minutes. A genuine remote content edit landing on the exact same byte count is vanishingly
  // rare, so treat unchanged size (with no hash to check instead) as unchanged content.
  if (remoteChanged && remote && record && !remote.hash && remote.size === record.remoteSize) {
    remoteChanged = false;
  }

  // Size+mtime says "local changed," but that's also what a plain re-save with no content edit looks like
  // (many editors rewrite the whole file on save). When the provider actually gives us a real remote hash
  // to compare against (Drive md5Checksum, S3 ETag — MEGA/OneDrive/pCloud leave it empty), hash the local
  // file once and short-circuit if content is actually identical — same disk read cost as the upload would
  // have paid anyway, but skips the network transfer and avoids a false "conflict" if the remote also
  // shows as changed by mtime alone.
  let localHash: string | undefined;
  if (localChanged && local && record?.remoteHash) {
    localHash = (await hashFile(local.absPath)) ?? undefined;
    if (localHash && localHash === record.remoteHash) {
      localChanged = false;
      state[relPath] = { ...record, localSize: local.size, localModifiedAt: local.modifiedAt, localHash };
      if (!remoteChanged) return; // confirmed identical both sides, nothing left to do
    }
  }

  // one side vanished — figure out whether that's a real delete to propagate or the OTHER side just
  // never had it yet (brand new file, no baseline at all).
  if (local && !remote) {
    if (direction === 'download-only') return; // never push — a local-only file just isn't this pass's concern
    const hadBaseline = record?.remoteModifiedAt !== undefined;
    // backup-only: local is master — a remote-side deletion should never remove the local "source of
    // truth" copy. Falls through to the push-it-back-up path below instead of honoring the delete.
    if (hadBaseline && !localChanged && direction !== 'backup-only') {
      // remote was deleted, local is untouched since — honor the delete locally too, via trash rather than
      // a hard unlink so an accidental remote delete doesn't destroy the only remaining copy.
      await trashLocalFile(folder.id, relPath, localAbsPath).catch(() => {});
      delete state[relPath];
      emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, deleted: true } });
      return;
    }
    // either brand new locally, or local was edited after the remote copy disappeared (or backup-only,
    // which always takes this path) — never destroy edited local content just because the other side is
    // gone, push it back up instead.
    const data = await fs.readFile(localAbsPath);
    assertFileSizeOk(folder, data.length);
    const hash = localHash ?? (await hashFile(localAbsPath)) ?? undefined;
    await throttle(data.length);
    await target.put(remoteKey, data);
    state[relPath] = { localSize: local.size, localModifiedAt: local.modifiedAt, localHash: hash, remoteSize: local.size, remoteModifiedAt: local.modifiedAt, remoteHash: hash, lastSyncedAt: new Date().toISOString(), status: 'synced' };
    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, size: data.length } });
    return;
  }

  if (remote && !local) {
    // backup-only: local is master, remote-only content isn't something this direction ever pulls down —
    // and a local deletion must never be allowed to delete the "backup" copy either. Nothing to do.
    if (direction === 'backup-only') return;
    const hadBaseline = record?.localModifiedAt !== undefined;
    // download-only never deletes remotely either — a local deletion just means the next pass re-pulls it.
    if (hadBaseline && !remoteChanged && direction !== 'download-only') {
      // local was deleted, remote is untouched since — honor the delete remotely too. Fetch the bytes into
      // trash BEFORE deleting, since there's no remote trash to move them to instead.
      try {
        const bytes = await target.get(remoteKey);
        await throttle(bytes.length);
        await trashRemoteBytes(folder.id, relPath, bytes);
      } catch {
        // couldn't grab a backup copy — proceed with the delete anyway rather than blocking sync on it
      }
      await target.delete(remoteKey).catch(() => {});
      delete state[relPath];
      emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, deleted: true } });
      return;
    }
    // brand new remotely, or remote changed after local vanished — pull it down.
    const data = await target.get(remoteKey);
    await throttle(data.length);
    await fs.mkdir(path.dirname(localAbsPath), { recursive: true });
    await fs.writeFile(localAbsPath, data);
    const stat = await fs.stat(localAbsPath);
    state[relPath] = { localSize: stat.size, localModifiedAt: stat.mtime.toISOString(), localHash: hashBuffer(data) ?? undefined, remoteSize: remote.size, remoteModifiedAt: remote.modifiedAt, remoteHash: remote.hash || undefined, lastSyncedAt: new Date().toISOString(), status: 'synced' };
    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, size: data.length } });
    return;
  }

  // both exist past this point
  if (!local || !remote) return; // unreachable, narrows types below

  if (!localChanged && !remoteChanged) return; // already in sync, nothing to do

  // no baseline at all for this path (folder just got Auto-Sync turned on, or this file predates it) —
  // "both changed since a baseline that never existed" is trivially true for EVERY pre-existing file,
  // which would otherwise manufacture a phantom conflict-copy for files that were actually already
  // identical on both sides. Same-size is treated as "already in sync, just never recorded" rather than a
  // real conflict; only an actual size mismatch on a fresh baseline goes through real conflict handling.
  if (!record && local.size === remote.size) {
    state[relPath] = { localSize: local.size, localModifiedAt: local.modifiedAt, remoteSize: remote.size, remoteModifiedAt: remote.modifiedAt, remoteHash: remote.hash || undefined, lastSyncedAt: new Date().toISOString(), status: 'synced' };
    return;
  }

  if (localChanged && !remoteChanged) {
    if (direction === 'download-only') return; // never push — the next pull-friendly pass leaves this alone
    const data = await fs.readFile(localAbsPath);
    assertFileSizeOk(folder, data.length);
    const hash = localHash ?? (await hashFile(localAbsPath)) ?? undefined;
    await throttle(data.length);
    await target.put(remoteKey, data);
    state[relPath] = { localSize: local.size, localModifiedAt: local.modifiedAt, localHash: hash, remoteSize: local.size, remoteModifiedAt: local.modifiedAt, remoteHash: hash, lastSyncedAt: new Date().toISOString(), status: 'synced' };
    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, size: data.length } });
    return;
  }

  if (remoteChanged && !localChanged) {
    if (direction === 'backup-only') return; // local is master — never let a remote-side edit overwrite it
    const data = await target.get(remoteKey);
    await throttle(data.length);
    await fs.writeFile(localAbsPath, data);
    const stat = await fs.stat(localAbsPath);
    state[relPath] = { localSize: stat.size, localModifiedAt: stat.mtime.toISOString(), localHash: hashBuffer(data) ?? undefined, remoteSize: remote.size, remoteModifiedAt: remote.modifiedAt, remoteHash: remote.hash || undefined, lastSyncedAt: new Date().toISOString(), status: 'synced' };
    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, size: data.length } });
    return;
  }

  // both sides changed at once — for a directional pair there's no real conflict to resolve, the direction
  // itself already says which side is the source of truth. Push local straight over remote (backup-only)
  // or pull remote straight over local (download-only), no conflict copy — that machinery is only for
  // two-way, where either side could legitimately be "right."
  if (direction === 'backup-only') {
    const data = await fs.readFile(localAbsPath);
    assertFileSizeOk(folder, data.length);
    const hash = localHash ?? (await hashFile(localAbsPath)) ?? undefined;
    await throttle(data.length);
    await target.put(remoteKey, data);
    state[relPath] = { localSize: local.size, localModifiedAt: local.modifiedAt, localHash: hash, remoteSize: local.size, remoteModifiedAt: local.modifiedAt, remoteHash: hash, lastSyncedAt: new Date().toISOString(), status: 'synced' };
    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, size: data.length } });
    return;
  }
  if (direction === 'download-only') {
    const data = await target.get(remoteKey);
    await throttle(data.length);
    await fs.writeFile(localAbsPath, data);
    const stat = await fs.stat(localAbsPath);
    state[relPath] = { localSize: stat.size, localModifiedAt: stat.mtime.toISOString(), localHash: hashBuffer(data) ?? undefined, remoteSize: remote.size, remoteModifiedAt: remote.modifiedAt, remoteHash: remote.hash || undefined, lastSyncedAt: new Date().toISOString(), status: 'synced' };
    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: remoteKey, size: data.length } });
    return;
  }

  // both changed since the last confirmed-in-sync baseline — a real conflict. Newer wins; the older side
  // gets renamed to a "(conflict TIMESTAMP)" copy on ITS OWN side rather than silently overwritten, so
  // nothing is ever actually lost — then the winning content propagates to the other side under the
  // original name, same as any other one-sided change from here.
  const localIsNewer = new Date(local.modifiedAt).getTime() >= new Date(remote.modifiedAt).getTime();
  if (localIsNewer) {
    const loserName = conflictName(relPath, 'remote');
    const loserData = await target.get(remoteKey);
    await throttle(loserData.length);
    await target.put(path.posix.join(folder.remotePrefix, loserName), loserData);
    const winnerData = await fs.readFile(localAbsPath);
    assertFileSizeOk(folder, winnerData.length);
    const hash = localHash ?? (await hashFile(localAbsPath)) ?? undefined;
    await throttle(winnerData.length);
    await target.put(remoteKey, winnerData);
    state[relPath] = { localSize: local.size, localModifiedAt: local.modifiedAt, localHash: hash, remoteSize: local.size, remoteModifiedAt: local.modifiedAt, remoteHash: hash, lastSyncedAt: new Date().toISOString(), status: 'synced' };
  } else {
    const loserName = conflictName(relPath, 'local');
    const loserAbsPath = path.join(folder.localPath!, loserName);
    await fs.rename(localAbsPath, loserAbsPath).catch(async () => {
      // cross-device rename can fail — fall back to copy since this is a rename within the same folder tree in practice
      const data = await fs.readFile(localAbsPath);
      await fs.writeFile(loserAbsPath, data);
    });
    const winnerData = await target.get(remoteKey);
    await throttle(winnerData.length);
    await fs.writeFile(localAbsPath, winnerData);
    const stat = await fs.stat(localAbsPath);
    state[relPath] = { localSize: stat.size, localModifiedAt: stat.mtime.toISOString(), localHash: hashBuffer(winnerData) ?? undefined, remoteSize: remote.size, remoteModifiedAt: remote.modifiedAt, remoteHash: remote.hash || undefined, lastSyncedAt: new Date().toISOString(), status: 'synced' };
  }
  emitSyncEvent({
    type: 'conflict',
    folderId: folder.id,
    payload: { key: remoteKey, resolution: localIsNewer ? 'kept local, remote saved as conflict copy' : 'kept remote, local saved as conflict copy' },
  });
}

// Local-side rename detection — the common case (user renames/moves a file in Finder) otherwise looks like
// an ordinary delete+create pair: a full re-upload of content the cloud already has, plus two unrelated-
// looking activity log lines instead of one "renamed" line. Only worth hashing a bounded candidate set
// (paths that actually disappeared, matched by size first) — never touches the rest of the tree.
async function detectRenames(folder: FolderConfig, target: SyncTarget, state: FolderSyncState, localFiles: Map<string, LocalFileInfo>): Promise<Set<string>> {
  const handled = new Set<string>();
  if (folder.direction === 'download-only') return handled; // never pushes a local rename either
  const goneLocalPaths = Object.keys(state).filter((p) => !localFiles.has(p) && state[p].localHash);
  if (!goneLocalPaths.length) return handled;
  const newLocalPaths = [...localFiles.keys()].filter((p) => !state[p]);
  if (!newLocalPaths.length) return handled;

  for (const newPath of newLocalPaths) {
    const info = localFiles.get(newPath)!;
    const sizeMatches = goneLocalPaths.filter((gp) => state[gp].localSize === info.size && !handled.has(gp));
    if (!sizeMatches.length) continue;
    const hash = await hashFile(info.absPath);
    if (!hash) continue;
    const match = sizeMatches.find((gp) => state[gp].localHash === hash);
    if (!match) continue;

    const oldRemoteKey = path.posix.join(folder.remotePrefix, match);
    const newRemoteKey = path.posix.join(folder.remotePrefix, newPath);
    try {
      // no move/rename primitive on SyncTarget yet — still costs a real re-upload, just avoids the
      // misleading "deleted X, created Y" pair of log lines and the resulting phantom-conflict-style reset.
      const data = await fs.readFile(info.absPath);
      await throttle(data.length);
      await target.put(newRemoteKey, data);
      await target.delete(oldRemoteKey).catch(() => {});
      delete state[match];
      state[newPath] = { localSize: info.size, localModifiedAt: info.modifiedAt, localHash: hash, remoteSize: info.size, remoteModifiedAt: info.modifiedAt, remoteHash: hash, lastSyncedAt: new Date().toISOString(), status: 'synced' };
      emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: newRemoteKey, renamedFrom: oldRemoteKey } });
    } catch (err) {
      console.error(`rename propagation failed for "${folder.name}/${match}" -> "${newPath}":`, err instanceof Error ? err.message : err);
      continue; // leave both paths for the normal per-path loop to fall back to plain delete+create
    }
    handled.add(match);
    handled.add(newPath);
  }
  return handled;
}

// One full reconciliation pass for an Auto-Sync folder — lists both sides, diffs each path against the
// stored baseline, and resolves every difference (push/pull/delete-propagation/conflict). Called once at
// startup for every Auto-Sync folder (catches anything that changed while the app was closed, since the
// live local watcher only sees changes from the moment it starts) and then on a plain interval afterward
// (the local side already gets near-instant propagation via the chokidar watcher in engine.ts — this pass
// is what actually notices REMOTE changes, since cloud/device targets have no push mechanism to us).
export async function reconcileFolder(folder: FolderConfig, target: SyncTarget): Promise<void> {
  if (!folder.localPath) return;
  const state = loadSyncState(folder.id);

  let localFiles: Map<string, LocalFileInfo>;
  let remoteEntries: FileEntry[];
  try {
    [localFiles, remoteEntries] = await Promise.all([walkLocal(folder.localPath), target.list(folder.remotePrefix)]);
  } catch (err) {
    console.error(`auto-sync reconciliation failed for "${folder.name}":`, err instanceof Error ? err.message : err);
    emitSyncEvent({ type: 'error', folderId: folder.id, payload: { message: err instanceof Error ? err.message : String(err) } });
    const existingProgress = progressByFolder.get(folder.id);
    if (existingProgress) progressByFolder.set(folder.id, { ...existingProgress, active: false });
    return;
  }

  // APFS (this Mac's default) is case-INSENSITIVE — "Photo.jpg" and "photo.jpg" are the same file on
  // disk, there's no way to have both locally. Cloud storage IS case-sensitive, so two distinct remote
  // objects differing only by case would otherwise both claim to correspond to that one local file — each
  // reconciliation pass would then flip-flop pulling one down over the other forever, the same
  // never-converges shape as the duplicate-upload bug fixed earlier. Resolved here by: matching a remote
  // entry's casing to an existing local file's actual casing when there is one, and when two remote
  // entries collide purely against EACH OTHER (no local file involved), keeping only the more recently
  // modified one for this pass rather than processing both.
  const localKeysByLower = new Map<string, string>();
  for (const key of localFiles.keys()) localKeysByLower.set(key.toLowerCase(), key);

  const remoteByRelPath = new Map<string, FileEntry>();
  const remoteLowerSeen = new Map<string, string>(); // lowercase -> the actual key currently stored under
  for (const entry of remoteEntries) {
    let rel = entry.path.startsWith(folder.remotePrefix) ? entry.path.slice(folder.remotePrefix.length).replace(/^\//, '') : entry.path;
    // isIgnored()/dotfile filtering was only ever applied on the LOCAL walk — a remote-side leftover
    // matching the ignore list (most commonly a .DS_Store uploaded before ignore rules existed) was never
    // excluded from the remote listing at all. That produced a real infinite loop: pull it down, then
    // walkLocal excludes it as a dotfile on the very next pass (it never gets tracked going forward), which
    // looks like "local deleted this," so it gets trashed locally — but never deleted remotely — so the
    // pass after THAT sees it as brand-new-remotely again and re-pulls it, forever. Filtering it out of the
    // remote side here means it's simply not part of what this sync manages, same as it already isn't
    // locally, instead of round-tripping between the two views of what should be ignored.
    const baseName = rel.split('/').pop() ?? rel;
    if (baseName.startsWith('.') || isIgnored(baseName)) continue;
    const lower = rel.toLowerCase();
    const localMatch = localKeysByLower.get(lower);
    if (localMatch) rel = localMatch; // pair up with the local file regardless of remote's exact casing

    const existingKey = remoteLowerSeen.get(lower);
    if (existingKey && existingKey !== rel) {
      const existingEntry = remoteByRelPath.get(existingKey)!;
      const thisIsNewer = new Date(entry.modifiedAt).getTime() > new Date(existingEntry.modifiedAt).getTime();
      if (!thisIsNewer) continue; // keep the one already stored, skip this older case-variant duplicate
      remoteByRelPath.delete(existingKey);
    }
    remoteLowerSeen.set(lower, rel);
    remoteByRelPath.set(rel, entry);
  }

  // Preflight, once per pass rather than per file — a large incoming batch (pulling down a folder that
  // suddenly has a lot of new remote content) could fill the disk before any individual file-level check
  // would catch it, and a large outgoing batch could blow through the account's quota mid-pass leaving a
  // partial, confusing state. Both are estimates (see syncSafety.ts) — good enough to gate a whole pass,
  // not a promise of exact byte accounting.
  // Same walk also flags which paths actually look different from their last-known-synced baseline — used
  // below to decide whether this pass has any REAL work, instead of the progress bar/UI claiming "syncing"
  // on every periodic pass even when every file is already fully up to date (which is what a plain
  // "did we visit every tracked path" count would do — every path gets visited every 2 minutes purely to
  // check for remote changes, that was never the same thing as work actually happening).
  let incomingPullBytes = 0;
  let outgoingPushBytes = 0;
  const likelyChanged = new Set<string>();
  for (const [relPath, entry] of remoteByRelPath) {
    const rec = state[relPath];
    if (!localFiles.has(relPath) || (rec && entry.size !== rec.remoteSize)) {
      incomingPullBytes += entry.size;
      likelyChanged.add(relPath);
    }
  }
  for (const [relPath, info] of localFiles) {
    const rec = state[relPath];
    if (!remoteByRelPath.has(relPath) || (rec && info.size !== rec.localSize)) {
      outgoingPushBytes += info.size;
      likelyChanged.add(relPath);
    }
  }

  if (incomingPullBytes > 0) {
    const free = await freeDiskSpace(folder.localPath);
    if (free !== null && free < incomingPullBytes * 1.1) {
      const msg = `not enough free disk space — this pass needs ~${(incomingPullBytes / 1024 ** 3).toFixed(1)}GB, only ${(free / 1024 ** 3).toFixed(1)}GB free`;
      console.error(`auto-sync aborted for "${folder.name}": ${msg}`);
      emitSyncEvent({ type: 'error', folderId: folder.id, payload: { message: msg } });
      return;
    }
  }

  if (outgoingPushBytes > 0) {
    const quota = await estimateQuota(folder, target, remoteEntries).catch(() => null);
    if (quota && quota.usedBytes + outgoingPushBytes > quota.totalBytes) {
      const msg = `not enough remaining storage on this account — this pass needs ~${(outgoingPushBytes / 1024 ** 3).toFixed(1)}GB, only ${Math.max(0, (quota.totalBytes - quota.usedBytes) / 1024 ** 3).toFixed(1)}GB left`;
      console.error(`auto-sync aborted for "${folder.name}": ${msg}`);
      emitSyncEvent({ type: 'error', folderId: folder.id, payload: { message: msg } });
      return;
    }
  }

  const handledAsRename = await detectRenames(folder, target, state, localFiles).catch(() => new Set<string>());

  const allPaths = new Set<string>([...localFiles.keys(), ...remoteByRelPath.keys(), ...Object.keys(state)]);
  const now = Date.now();

  // Real work this pass = paths that looked different above, plus anything already resolved as a rename.
  // Everything else in allPaths is either already-in-sync (the loop below will no-op on it near-instantly)
  // or a stale state entry getting cleaned up — neither is "syncing" in any user-visible sense, so the
  // progress bar only lights up when there's actually something to show.
  const workTotal = likelyChanged.size + handledAsRename.size;
  if (workTotal > 0) {
    progressByFolder.set(folder.id, { done: handledAsRename.size, total: workTotal, active: true, startedAt: new Date().toISOString() });
  } else {
    const existingProgress = progressByFolder.get(folder.id);
    if (existingProgress?.active) progressByFolder.set(folder.id, { ...existingProgress, active: false });
  }

  for (const relPath of allPaths) {
    if (handledAsRename.has(relPath)) continue;
    const existing = state[relPath];
    if (existing?.nextRetryAt && new Date(existing.nextRetryAt).getTime() > now) {
      if (likelyChanged.has(relPath)) {
        const p = progressByFolder.get(folder.id);
        if (p) p.done += 1; // backing off counts as "handled" for this pass, not stuck
      }
      continue;
    }

    try {
      await reconcileOne(folder, target, state, relPath, localFiles.get(relPath), remoteByRelPath.get(relPath));
    } catch (err) {
      const prevRetryCount = state[relPath]?.retryCount ?? existing?.retryCount ?? 0;
      const retryCount = prevRetryCount + 1;
      const delayMs = Math.min(RETRY_BASE_MS * 2 ** (retryCount - 1), RETRY_MAX_MS);
      state[relPath] = {
        ...(existing ?? {}),
        status: 'error',
        retryCount,
        nextRetryAt: new Date(now + delayMs).toISOString(),
        lastError: err instanceof Error ? err.message : String(err),
      };
      console.error(`auto-sync failed for "${folder.name}/${relPath}" (retry ${retryCount} in ${Math.round(delayMs / 1000)}s):`, err instanceof Error ? err.message : err);
      emitSyncEvent({
        type: 'error',
        folderId: folder.id,
        payload: { key: path.posix.join(folder.remotePrefix, relPath), message: err instanceof Error ? err.message : String(err) },
      });
    }
    if (likelyChanged.has(relPath)) {
      const p = progressByFolder.get(folder.id);
      if (p) p.done += 1;
    }
  }

  const finalProgress = progressByFolder.get(folder.id);
  if (finalProgress) progressByFolder.set(folder.id, { ...finalProgress, active: false });

  saveSyncState(folder.id, state);
}

/** Records a local change immediately (called from the live chokidar watcher path in engine.ts) so the
 * next reconciliation pass doesn't see it as untracked and re-derive what already just happened. `hash` is
 * optional (the caller already has the bytes in memory from the push it just did) — without it, this path
 * later on can't be a rename-detection candidate, just falls back to ordinary delete+create like before
 * hashing existed. */
export function recordLocalSync(folderId: string, relPath: string, size: number, modifiedAt: string, deleted: boolean, hash?: string): void {
  const state = loadSyncState(folderId);
  if (deleted) {
    delete state[relPath];
  } else {
    const existing = state[relPath];
    // provenance ("added by" in the Universal Sync Folder Details action) is set once, on the FIRST time
    // this device ever sees this relPath — the spread below then preserves it on every later update
    // (an edit doesn't change who originally added the file). A device that only ever PULLS a file down
    // via reconciliation (never pushes it itself) has no way to know who really authored it, so this stays
    // unset for those — Details shows "Unknown (synced from elsewhere)" rather than a guess.
    const provenance = existing?.addedByDeviceId
      ? {}
      : { addedByDeviceId: getDeviceIdentity().id, addedByDeviceName: getDeviceIdentity().name, addedAt: new Date().toISOString() };
    state[relPath] = {
      ...existing,
      ...provenance,
      localSize: size,
      localModifiedAt: modifiedAt,
      localHash: hash,
      remoteSize: size,
      remoteModifiedAt: modifiedAt,
      remoteHash: hash,
      lastSyncedAt: new Date().toISOString(),
      status: 'synced',
      retryCount: undefined,
      nextRetryAt: undefined,
      lastError: undefined,
    };
  }
  saveSyncState(folderId, state);
}
