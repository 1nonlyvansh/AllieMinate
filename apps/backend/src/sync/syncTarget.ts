import type { FileEntry } from '@alliminate/shared';
import type { StorageBackend } from '../storage/StorageBackend';
import type { PairedDevice } from '../pairing';

// The "other side" of an Auto-Sync folder pair — either a cloud account or a paired desktop device.
// Deliberately the smallest surface the reconciliation engine needs, not the full StorageBackend
// interface — every StorageBackend already structurally satisfies this (put/get/delete/list), so a cloud
// target needs zero adapter code; only the device case needs a real implementation (DeviceSyncTarget
// below), since a paired device isn't a StorageBackend, it's another AllieMinate instance over HTTP.
export interface SyncTarget {
  list(prefix: string): Promise<FileEntry[]>;
  get(key: string): Promise<Buffer>;
  put(key: string, data: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
}

// A paired device's OWN folder, addressed the same way its Devices-browsing proxy already does
// (devices.ts's /devices/:id/folders/:folderId/* routes use the exact same underlying calls this makes
// directly instead, since the reconciliation engine runs on the SENDING side and needs raw bytes, not a
// browser-facing proxy response). Android peers only ever expose a fixed "received" bucket as a write
// target (no arbitrary folder structure), so this only makes real two-way sync sense for a Mac/Windows
// peer with its own real FolderConfig on the far side; against an Android peer it still works, but
// degrades to a one-directional drop into "received" — deletes are never propagated to it, since Android
// has no delete route.
export class DeviceSyncTarget implements SyncTarget {
  constructor(
    private peer: PairedDevice,
    private remoteFolderId: string,
    private isAndroid: boolean,
  ) {}

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.peer.token}` };
  }

  async list(_prefix: string): Promise<FileEntry[]> {
    const res = await fetch(`http://${this.peer.host}/folders/${this.remoteFolderId}/files`, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`device unreachable (${res.status})`);
    const data = await res.json();
    return (data.files ?? []) as FileEntry[];
  }

  async get(key: string): Promise<Buffer> {
    const res = await fetch(`http://${this.peer.host}/folders/${this.remoteFolderId}/download?key=${encodeURIComponent(key)}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`device unreachable (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Phase 6 prep: the Android degradation only actually applies to the fixed "received" bucket (its one
  // writable target today) — keying it off `remoteFolderId === 'received'` instead of `isAndroid`
  // unconditionally means the desktop side already does the right thing the moment Android gains real
  // arbitrary-folder routes for some OTHER folder id, no desktop change needed when that lands.
  private get isFixedAndroidInbox(): boolean {
    return this.isAndroid && this.remoteFolderId === 'received';
  }

  async put(key: string, data: Buffer): Promise<void> {
    const name = key.split('/').pop() ?? key;
    const targetFolder = this.isFixedAndroidInbox ? 'received' : this.remoteFolderId;
    const res = await fetch(`http://${this.peer.host}/folders/${targetFolder}/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`device rejected the file (${res.status})`);
  }

  async delete(key: string): Promise<void> {
    if (this.isFixedAndroidInbox) return; // no delete route on the phone's "received" bucket — see class comment
    const res = await fetch(`http://${this.peer.host}/folders/${this.remoteFolderId}/file?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`device rejected the delete (${res.status})`);
  }
}

export function asSyncTarget(backend: StorageBackend): SyncTarget {
  return backend; // structurally compatible already — put/get/delete/list match exactly
}
