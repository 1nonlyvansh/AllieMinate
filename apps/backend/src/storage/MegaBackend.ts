import { Storage, MutableFile, File as MegaFile } from 'megajs';
import type { EventEmitter } from 'node:events';
import type { FileEntry, FolderNode } from '@alliminate/shared';
import type { StorageBackend } from './StorageBackend';
import type { MegaConfig } from '../config';

const ROOT_FOLDER_NAME = 'AllieMinate';
const LOGIN_TIMEOUT_MS = 15_000;

// a hung MEGA login (DNS resolution stuck, TCP connect stuck with no response — seen in practice when
// g.api.mega.co.nz is unreachable) has no built-in timeout in megajs, so `storage.ready` can sit pending
// forever with neither a resolve nor a reject. Any route awaiting it (list/browseFolder/etc, and by
// extension the whole aggregation in GET /recent's Promise.all) would then hang indefinitely too — this
// bounds that wait so a broken MEGA account degrades to "MEGA timed out" instead of wedging every request
// that happens to touch it.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function uploadBuffer(parent: MutableFile, name: string, data: Buffer): Promise<MutableFile> {
  return new Promise((resolve, reject) => {
    const stream = parent.upload({ name, size: data.length }, data);
    stream.on('complete', (file: MutableFile) => resolve(file));
    stream.on('error', reject);
  });
}

function findNode(root: MegaFile, id: string): MegaFile | undefined {
  if (root.nodeId === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function walk(node: MegaFile, prefix: string, out: { path: string; file: MegaFile }[]): void {
  for (const child of node.children ?? []) {
    const path = prefix + (child.name ?? '');
    if (child.directory) walk(child, path + '/', out);
    else out.push({ path, file: child });
  }
}

export class MegaBackend implements StorageBackend {
  private storagePromise: Promise<Storage>;
  private rootFolder: MutableFile | null = null;

  constructor(cfg: MegaConfig) {
    const storage = new Storage({ email: cfg.email, password: cfg.password });
    // megajs's Storage is an EventEmitter that emits 'error' on login/network failure (e.g. DNS lookup to
    // g.api.mega.co.nz failing while offline) IN ADDITION to rejecting `.ready` — Node throws synchronously
    // on an unhandled 'error' event with no listener attached, which was crashing the whole backend process
    // outright rather than surfacing as a normal rejected request. This listener is a no-op: `.ready`'s own
    // rejection already propagates to every caller through the regular async/await chain below.
    // megajs's .d.ts only types 'add'/'move'/'ready'/'update'/'delete' overloads for .on(), even though
    // Storage extends EventEmitter and really does emit 'error' — go through the EventEmitter base type
    // to attach a listener for an event the narrower overloads don't know about.
    (storage as unknown as EventEmitter).on('error', () => {});
    this.storagePromise = withTimeout(storage.ready, LOGIN_TIMEOUT_MS, 'MEGA login');
    // if login fails before anything ever awaits this backend (e.g. the app just booted and no route has
    // touched MEGA yet), the rejection would otherwise sit "unhandled" past the current microtask and trip
    // Node's default unhandledRejection-crashes-the-process behavior. This no-op catch doesn't consume the
    // promise for real callers below — every await on `this.storagePromise` still sees the same rejection.
    this.storagePromise.catch(() => {});
  }

  private async getRootFolder(): Promise<MutableFile> {
    if (this.rootFolder) return this.rootFolder;

    const storage = await this.storagePromise;
    const existing = storage.root.children?.find(
      (f) => f.name === ROOT_FOLDER_NAME && f.directory,
    );

    this.rootFolder = existing ?? (await storage.root.mkdir(ROOT_FOLDER_NAME));
    return this.rootFolder;
  }

  private async findFile(key: string): Promise<MutableFile | null> {
    const root = await this.getRootFolder();
    const inRoot = root.children?.find((f) => f.name === key);
    if (inRoot) return inRoot as MutableFile;

    // not an AllieMinate-managed file — fall back to a whole-account path search
    // (covers previewing/downloading files surfaced by listAll()).
    const storage = await this.storagePromise;
    const all: { path: string; file: MegaFile }[] = [];
    walk(storage.root, '', all);
    return (all.find((e) => e.path === key)?.file as MutableFile) ?? null;
  }

  async put(key: string, data: Buffer): Promise<void> {
    // MEGA allows multiple files with the identical name in the same folder (unlike S3/Drive) — a
    // concurrency bug elsewhere (two overlapping reconciliation passes racing to "replace" the same file)
    // was producing real duplicates here instead of an overwrite. findFile() only returns the FIRST match,
    // which silently left any earlier duplicate behind — deleting every match instead means an existing
    // duplicate self-heals back down to one file the next time this path gets synced, rather than staying
    // stuck at two forever.
    const root = await this.getRootFolder();
    const existing = (root.children ?? []).filter((f) => f.name === key);
    await Promise.all(existing.map((f) => (f as MutableFile).delete(true)));

    await uploadBuffer(root, key, data);
  }

  async get(key: string): Promise<Buffer> {
    const file = await this.findFile(key);
    if (!file) throw new Error(`file not found: ${key}`);
    return file.downloadBuffer({});
  }

  async delete(key: string): Promise<void> {
    const file = await this.findFile(key);
    if (!file) return;
    await file.delete(true);
  }

  async list(prefix: string): Promise<FileEntry[]> {
    const root = await this.getRootFolder();
    return (root.children ?? [])
      .filter((f) => !f.directory && f.name?.startsWith(prefix))
      .map((f) => ({
        path: f.name ?? '',
        size: f.size ?? 0,
        hash: '',
        modifiedAt: f.timestamp
          ? new Date(f.timestamp * 1000).toISOString()
          : new Date(0).toISOString(),
      }));
  }

  /** One level of the account's REAL tree, starting at Mega's actual root — not the AllieMinate managed
   * folder. Mega's whole tree is already loaded in memory (megajs builds it on Storage.ready), so this is
   * just a lookup, not a network round-trip. */
  async browseFolder(folderId: string | null): Promise<{ folders: FolderNode[]; files: FileEntry[] }> {
    const storage = await this.storagePromise;
    const node = folderId ? findNode(storage.root, folderId) : storage.root;
    if (!node) throw new Error('folder not found');
    const folders: FolderNode[] = (node.children ?? [])
      .filter((f) => f.directory)
      .map((f) => ({ id: f.nodeId ?? '', name: f.name ?? '' }));
    const files: FileEntry[] = (node.children ?? [])
      .filter((f) => !f.directory)
      .map((f) => ({
        path: f.name ?? '',
        size: f.size ?? 0,
        hash: '',
        modifiedAt: f.timestamp ? new Date(f.timestamp * 1000).toISOString() : new Date(0).toISOString(),
      }));
    return { folders, files };
  }

  async makeFolder(parentId: string | null, name: string): Promise<FolderNode> {
    const storage = await this.storagePromise;
    const parent = parentId ? findNode(storage.root, parentId) : storage.root;
    if (!parent) throw new Error('parent folder not found');
    const created = await (parent as MutableFile).mkdir(name);
    return { id: created.nodeId ?? '', name };
  }

  async putInFolder(folderId: string | null, name: string, data: Buffer): Promise<void> {
    const storage = await this.storagePromise;
    const parent = folderId ? findNode(storage.root, folderId) : storage.root;
    if (!parent) throw new Error('folder not found');
    // Same dedup put() already does above — this is the OTHER upload path (the /providers/:id/upload
    // relay Android's Sync Engine uses to push into a real folder), which never got the fix: a phone-side
    // race between the FileObserver-triggered push and the periodic WorkManager scan both firing for the
    // same unchanged file produced real MEGA duplicates, since uploadBuffer() alone never overwrites.
    const existing = (parent.children ?? []).filter((f) => f.name === name);
    await Promise.all(existing.map((f) => (f as MutableFile).delete(true)));
    await uploadBuffer(parent as MutableFile, name, data);
  }

  /** Every file in the whole MEGA account, not just the AllieMinate-managed folder. Read-heavy — used for the Cloud Services browser. */
  async listAll(): Promise<FileEntry[]> {
    const storage = await this.storagePromise;
    const all: { path: string; file: MegaFile }[] = [];
    walk(storage.root, '', all);

    return all.map(({ path, file }) => ({
      path,
      size: file.size ?? 0,
      hash: '',
      modifiedAt: file.timestamp ? new Date(file.timestamp * 1000).toISOString() : new Date(0).toISOString(),
    }));
  }
}
