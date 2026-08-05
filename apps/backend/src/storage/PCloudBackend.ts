import type { FileEntry, FolderNode } from '@alliminate/shared';
import type { StorageBackend } from './StorageBackend';
import type { PCloudConfig } from '../config';

const ROOT_PATH = '/AllieMinate';

interface PCloudEntry {
  name: string;
  isfolder: boolean;
  size?: number;
  modified?: string;
  contents?: PCloudEntry[];
}

function walk(entries: PCloudEntry[], prefix: string, out: { path: string; entry: PCloudEntry }[]): void {
  for (const entry of entries) {
    const path = prefix + entry.name;
    if (entry.isfolder) walk(entry.contents ?? [], path + '/', out);
    else out.push({ path, entry });
  }
}

export class PCloudBackend implements StorageBackend {
  constructor(private cfg: PCloudConfig) {}

  private async call(method: string, params: Record<string, string> = {}): Promise<any> {
    const qs = new URLSearchParams({ ...params, access_token: this.cfg.accessToken });
    const res = await fetch(`https://${this.cfg.apiHost}/${method}?${qs.toString()}`);
    const data = await res.json();
    if (data.result !== 0) throw new Error(`pCloud ${method} failed: ${data.error ?? `code ${data.result}`}`);
    return data;
  }

  private async ensureRoot(): Promise<void> {
    await this.call('createfolderifnotexists', { path: ROOT_PATH });
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.ensureRoot();
    const remotePath = `${ROOT_PATH}/${key}`;
    const folder = remotePath.slice(0, remotePath.lastIndexOf('/')) || ROOT_PATH;
    const name = remotePath.slice(remotePath.lastIndexOf('/') + 1);
    if (folder !== ROOT_PATH) await this.call('createfolderifnotexists', { path: folder });

    // overwrite semantics: clear any existing file at this path first.
    try {
      await this.call('deletefile', { path: remotePath });
    } catch {
      // fine — nothing there yet
    }

    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(data)]), name);
    const qs = new URLSearchParams({ path: folder, access_token: this.cfg.accessToken });
    const res = await fetch(`https://${this.cfg.apiHost}/uploadfile?${qs.toString()}`, {
      method: 'POST',
      body: form,
    });
    const result = await res.json();
    if (result.result !== 0) throw new Error(`pCloud upload failed: ${result.error ?? `code ${result.result}`}`);
  }

  async get(key: string): Promise<Buffer> {
    const remotePath = await this.resolvePath(key);
    const data = await this.call('getfilelink', { path: remotePath });
    const url = `https://${data.hosts[0]}${data.path}`;
    const res = await fetch(url);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const remotePath = await this.resolvePath(key).catch(() => `${ROOT_PATH}/${key}`);
    await this.call('deletefile', { path: remotePath });
  }

  async list(prefix: string): Promise<FileEntry[]> {
    let data;
    try {
      data = await this.call('listfolder', { path: ROOT_PATH, recursive: '1' });
    } catch {
      return [];
    }
    const all: { path: string; entry: PCloudEntry }[] = [];
    walk(data.metadata.contents ?? [], '', all);
    return all
      .filter(({ path }) => path.startsWith(prefix))
      .map(({ path, entry }) => ({
        path,
        size: entry.size ?? 0,
        hash: '',
        modifiedAt: entry.modified ? new Date(entry.modified).toISOString() : new Date(0).toISOString(),
      }));
  }

  /** Every file in the whole pCloud account, not just the AllieMinate-managed folder. Read-heavy — used for the Cloud Services browser. */
  async listAll(): Promise<FileEntry[]> {
    const data = await this.call('listfolder', { path: '/', recursive: '1' });
    const all: { path: string; entry: PCloudEntry }[] = [];
    walk(data.metadata.contents ?? [], '', all);
    return all.map(({ path, entry }) => ({
      path,
      size: entry.size ?? 0,
      hash: '',
      modifiedAt: entry.modified ? new Date(entry.modified).toISOString() : new Date(0).toISOString(),
    }));
  }

  /** One level of the account's REAL tree, starting at pCloud's actual root ("/") — not the AllieMinate
   * managed folder. pCloud addresses everything by path, same as the rest of this class, so `folderId`
   * here is just that path. */
  async browseFolder(folderId: string | null): Promise<{ folders: FolderNode[]; files: FileEntry[] }> {
    const path = folderId ?? '/';
    let data;
    try {
      data = await this.call('listfolder', { path });
    } catch {
      return { folders: [], files: [] };
    }
    const contents: PCloudEntry[] = data.metadata.contents ?? [];
    const folders: FolderNode[] = contents
      .filter((e) => e.isfolder)
      .map((e) => ({ id: path === '/' ? `/${e.name}` : `${path}/${e.name}`, name: e.name }));
    const files: FileEntry[] = contents
      .filter((e) => !e.isfolder)
      .map((e) => ({
        path: e.name,
        size: e.size ?? 0,
        hash: '',
        modifiedAt: e.modified ? new Date(e.modified).toISOString() : new Date(0).toISOString(),
      }));
    return { folders, files };
  }

  async makeFolder(parentId: string | null, name: string): Promise<FolderNode> {
    const parent = parentId ?? '/';
    const path = parent === '/' ? `/${name}` : `${parent}/${name}`;
    await this.call('createfolderifnotexists', { path });
    return { id: path, name };
  }

  async putInFolder(folderId: string | null, name: string, data: Buffer): Promise<void> {
    const folder = folderId ?? '/';
    if (folder !== '/') await this.call('createfolderifnotexists', { path: folder });
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(data)]), name);
    const qs = new URLSearchParams({ path: folder, access_token: this.cfg.accessToken });
    const res = await fetch(`https://${this.cfg.apiHost}/uploadfile?${qs.toString()}`, {
      method: 'POST',
      body: form,
    });
    const result = await res.json();
    if (result.result !== 0) throw new Error(`pCloud upload failed: ${result.error ?? `code ${result.result}`}`);
  }

  /** Finds the real remote path for a key — checks the managed folder first, then falls back to a whole-account search (covers files surfaced by listAll()). */
  private async resolvePath(key: string): Promise<string> {
    const managedPath = `${ROOT_PATH}/${key}`;
    try {
      await this.call('stat', { path: managedPath });
      return managedPath;
    } catch {
      const data = await this.call('listfolder', { path: '/', recursive: '1' });
      const all: { path: string; entry: PCloudEntry }[] = [];
      walk(data.metadata.contents ?? [], '', all);
      const match = all.find((e) => e.path === key);
      if (!match) throw new Error(`file not found: ${key}`);
      return `/${key}`;
    }
  }
}
