import type { FileEntry, FolderNode } from '@alliminate/shared';
import type { StorageBackend } from './StorageBackend';
import type { OneDriveConfig } from '../config';
import { updateEnv } from '../env';

const ROOT_PATH = '/AllieMinate';
const GRAPH = 'https://graph.microsoft.com/v1.0';

interface GraphItem {
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: unknown;
  webUrl?: string;
}

export class OneDriveBackend implements StorageBackend {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private cfg: OneDriveConfig) {}

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;

    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: this.cfg.refreshToken,
        grant_type: 'refresh_token',
        scope: 'Files.ReadWrite offline_access',
      }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`OneDrive token refresh failed: ${data.error_description ?? data.error}`);

    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    if (data.refresh_token && data.refresh_token !== this.cfg.refreshToken) {
      this.cfg.refreshToken = data.refresh_token;
      updateEnv({ ONEDRIVE_REFRESH_TOKEN: data.refresh_token });
    }
    return this.accessToken!;
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.ensureToken();
    const res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OneDrive ${method} ${path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const segments = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      const parent = current || '/';
      current = `${current}/${segment}`;
      try {
        await this.call('GET', `/me/drive/root:${current}`);
      } catch {
        await this.call('POST', `/me/drive/root:${parent}:/children`, {
          name: segment,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'replace',
        });
      }
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    const remotePath = `${ROOT_PATH}/${key}`;
    const folder = remotePath.slice(0, remotePath.lastIndexOf('/')) || ROOT_PATH;
    if (folder !== ROOT_PATH) await this.ensureFolder(folder);
    else await this.ensureFolder(ROOT_PATH);

    const token = await this.ensureToken();
    const res = await fetch(`${GRAPH}/me/drive/root:${remotePath}:/content`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: Uint8Array.from(data),
    });
    if (!res.ok) throw new Error(`OneDrive upload failed: ${res.status} ${await res.text().catch(() => '')}`);
  }

  async get(key: string): Promise<Buffer> {
    const remotePath = await this.resolvePath(key);
    const token = await this.ensureToken();
    const res = await fetch(`${GRAPH}/me/drive/root:${remotePath}:/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`file not found: ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const remotePath = await this.resolvePath(key).catch(() => `${ROOT_PATH}/${key}`);
    await this.call('DELETE', `/me/drive/root:${remotePath}`);
  }

  private async walk(folderPath: string, prefix: string, out: { path: string; item: GraphItem }[]): Promise<void> {
    let data;
    try {
      data = await this.call('GET', `/me/drive/root:${folderPath}:/children`);
    } catch {
      return;
    }
    for (const item of (data.value ?? []) as GraphItem[]) {
      const path = prefix + item.name;
      if (item.folder) {
        await this.walk(`${folderPath}/${item.name}`, `${path}/`, out);
      } else {
        out.push({ path, item });
      }
    }
  }

  async list(prefix: string): Promise<FileEntry[]> {
    const out: { path: string; item: GraphItem }[] = [];
    await this.walk(ROOT_PATH, '', out);
    return out
      .filter(({ path }) => path.startsWith(prefix))
      .map(({ path, item }) => ({
        path,
        size: item.size ?? 0,
        hash: '',
        modifiedAt: item.lastModifiedDateTime ?? new Date(0).toISOString(),
      }));
  }

  /** Every file in the whole OneDrive account, not just the AllieMinate-managed folder. Read-heavy — used for the Cloud Services browser. */
  async listAll(): Promise<FileEntry[]> {
    const out: { path: string; item: GraphItem }[] = [];
    await this.walk('', '', out);
    return out.map(({ path, item }) => ({
      path,
      size: item.size ?? 0,
      hash: '',
      modifiedAt: item.lastModifiedDateTime ?? new Date(0).toISOString(),
    }));
  }

  /** Web-editable link (Word/Excel/PowerPoint Online) for a file already in this OneDrive account. */
  async getWebEditUrl(key: string): Promise<string | null> {
    try {
      const remotePath = await this.resolvePath(key);
      const data = await this.call('GET', `/me/drive/root:${remotePath}`);
      return data.webUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Real account-wide usage, matching what onedrive.live.com's own storage page shows. */
  async getAccountUsage(): Promise<{ usedBytes: number; totalBytes: number } | null> {
    try {
      const data = await this.call('GET', '/me/drive');
      if (!data.quota?.total) return null;
      return { usedBytes: Number(data.quota.used ?? 0), totalBytes: Number(data.quota.total) };
    } catch {
      return null;
    }
  }

  /** One level of the account's REAL tree, starting at the actual OneDrive root — not the AllieMinate
   * managed folder. `folderId` here is just the OneDrive path itself ("" = root), matching how the rest
   * of this class already addresses items — no separate id scheme needed. */
  async browseFolder(folderId: string | null): Promise<{ folders: FolderNode[]; files: FileEntry[] }> {
    const path = folderId ?? '';
    const endpoint = path ? `/me/drive/root:${path}:/children` : '/me/drive/root/children';
    const data = await this.call('GET', endpoint);
    const items = (data.value ?? []) as GraphItem[];
    const folders: FolderNode[] = items
      .filter((i) => i.folder)
      .map((i) => ({ id: `${path}/${i.name}`, name: i.name }));
    const files: FileEntry[] = items
      .filter((i) => !i.folder)
      .map((i) => ({
        path: i.name,
        size: i.size ?? 0,
        hash: '',
        modifiedAt: i.lastModifiedDateTime ?? new Date(0).toISOString(),
      }));
    return { folders, files };
  }

  async makeFolder(parentId: string | null, name: string): Promise<FolderNode> {
    const path = parentId ?? '';
    const endpoint = path ? `/me/drive/root:${path}:/children` : '/me/drive/root/children';
    await this.call('POST', endpoint, { name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' });
    return { id: `${path}/${name}`, name };
  }

  async putInFolder(folderId: string | null, name: string, data: Buffer): Promise<void> {
    const path = folderId ? `${folderId}/${name}` : `/${name}`;
    const token = await this.ensureToken();
    const res = await fetch(`${GRAPH}/me/drive/root:${path}:/content`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: Uint8Array.from(data),
    });
    if (!res.ok) throw new Error(`OneDrive upload failed: ${res.status} ${await res.text().catch(() => '')}`);
  }

  /** Finds the real remote path for a key — checks the managed folder first, then falls back to a whole-account search (covers files surfaced by listAll()). */
  private async resolvePath(key: string): Promise<string> {
    const managedPath = `${ROOT_PATH}/${key}`;
    try {
      await this.call('GET', `/me/drive/root:${managedPath}`);
      return managedPath;
    } catch {
      const out: { path: string; item: GraphItem }[] = [];
      await this.walk('', '', out);
      const match = out.find((e) => e.path === key);
      if (!match) throw new Error(`file not found: ${key}`);
      return `/${key}`;
    }
  }
}
