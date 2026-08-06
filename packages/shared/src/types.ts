export type StorageProviderId = 'b2' | 'idrive-e2' | 'google-drive' | 'pcloud' | 'mega' | 'onedrive';

/** base provider type from an account id — "google-drive:2" -> "google-drive". */
export function baseProviderOf(accountId: string): StorageProviderId {
  return accountId.split(':')[0] as StorageProviderId;
}

export interface FolderConfig {
  id: string;
  name: string;
  localPath: string;
  /** account id — a bare provider name ("b2") for single-account providers, or "google-drive:2" etc for extra linked accounts. */
  provider: string;
  remotePrefix: string;
  /** shown on the Overview/Pinned Folders grid — defaults to true when absent (older folders never had this field). */
  pinned?: boolean;
  /** Phase 5: Auto-Sync — when true, this folder gets real two-way sync (remote→local pulls, delete
   * propagation, conflict detection) on top of the always-on local→remote push every folder with a
   * localPath already has. Absent/false means the original one-way behavior, unchanged. */
  autoSync?: boolean;
  /** which kind of "other side" autoSync targets — 'cloud' means `provider` (already on this config) is
   * the target; 'device' means a paired device's own folder, addressed by syncDeviceId/syncDeviceFolderId. */
  syncTargetKind?: 'cloud' | 'device';
  /** paired device id, only set when syncTargetKind === 'device'. */
  syncDeviceId?: string;
  /** the folder id ON THE PAIRED DEVICE'S OWN SIDE to sync against — e.g. "received" for an Android peer
   * (its only writable target) or another FolderConfig id for a Mac/Windows peer. */
  syncDeviceFolderId?: string;
  /** which of the peer's folder namespaces syncDeviceFolderId lives in — 'folder' (default, back-compat)
   * means one of the peer's cloud-backed FolderConfig folders; 'local-folder' means one of its real OS
   * folders (Desktop/Downloads/a custom shortcut) with no cloud account involved at all. */
  syncDeviceFolderKind?: 'folder' | 'local-folder';
  /** Phase 5 — 'two-way' (default when absent, matches original behavior) propagates changes/deletes both
   * ways; 'backup-only' pushes local→remote and never deletes remotely even if the local copy is deleted;
   * 'download-only' pulls remote→local and never pushes local edits at all. */
  direction?: 'two-way' | 'backup-only' | 'download-only';
  /** Pins a REAL, pre-existing cloud folder (picked via the account's actual folder tree — /providers/:id/tree)
   * instead of AllieMinate's own flat name-prefix convention. When set, remotePrefix is unused for
   * listing/browsing this folder — reads go through backend.browseFolder(remoteFolderId) instead of
   * backend.list(remotePrefix), since a real folder can live anywhere in the account (not just inside
   * AllieMinate's own managed space, which is all the flat-prefix model ever looks at). */
  remoteFolderId?: string;
}

export interface FileEntry {
  path: string;
  size: number;
  hash: string;
  modifiedAt: string;
  /** native cloud mimeType (e.g. Google Docs/Sheets/Slides) — these have no file extension, so category
   * detection needs this to tell a Google Doc from an unknown/"other" file. */
  mimeType?: string;
  /** true creation timestamp where the provider exposes one (Drive, OneDrive) — S3-style backends only
   * track a single "last modified" and have no separate creation time. */
  createdAt?: string;
  /** Drive-generated preview image (covers pdf/docx/pptx/xlsx/video/images uniformly, server-side — no
   * client download or rendering needed). Only Drive exposes this; other providers leave it unset. */
  thumbnailUrl?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict';

/** a real, navigable folder inside a cloud account's raw file tree — id's shape is provider-specific
 * (Drive/OneDrive: object id; S3-compatible: key prefix ending in "/"; Mega: node id; pCloud: folderid). */
export interface FolderNode {
  id: string;
  name: string;
}

// bytes — the free-tier ceiling each provider advertises.
export const PROVIDER_QUOTA_BYTES: Record<StorageProviderId, number> = {
  b2: 10 * 1024 ** 3,
  'idrive-e2': 10 * 1024 ** 3,
  'google-drive': 15 * 1024 ** 3,
  mega: 20 * 1024 ** 3,
  pcloud: 10 * 1024 ** 3,
  onedrive: 5 * 1024 ** 3,
};

export interface ProviderStorage {
  /** account id, same key space as FolderConfig.provider */
  provider: string;
  usedBytes: number;
  totalBytes: number;
  /** connected account email, shown when multiple accounts share a base provider */
  label?: string;
}

export interface SyncEvent {
  type: 'status' | 'file-synced' | 'conflict' | 'error' | 'storage-updated' | 'nearby-request' | 'unlock-request';
  folderId: string;
  payload: unknown;
}

/** Sync Engine (v2): a local folder root mapped to a sync destination, independent of the pinned-folder /
 * FolderConfig model — a pinned cloud folder is already tied to one account by construction, but Sync
 * Engine lets you pick ANY local folder first and choose its destination account/device separately
 * (Google-Drive-Desktop-style), so it needed its own entity rather than overloading FolderConfig. */
export interface SyncPair {
  id: string;
  localPath: string;
  targetKind: 'cloud' | 'device';
  /** set when targetKind === 'cloud' — account id, same key space as FolderConfig.provider. */
  providerId?: string;
  /** set when targetKind === 'device'. */
  deviceId?: string;
  /** the folder id ON THE PAIRED DEVICE'S OWN SIDE — e.g. "received" for Android. */
  deviceFolderId?: string;
  /** which of the peer's folder namespaces deviceFolderId lives in — see FolderConfig.syncDeviceFolderKind
   * for the same distinction ('folder' = cloud-backed, 'local-folder' = a real OS folder, no cloud). */
  deviceFolderKind?: 'folder' | 'local-folder';
  /** destination path/prefix within the target. */
  remotePath: string;
  /** 'two-way' propagates changes/deletes both ways; 'backup-only' pushes local→remote and never deletes
   * remote content even if the local copy is deleted; 'download-only' is the mirror of that. */
  direction: 'two-way' | 'backup-only' | 'download-only';
  status: 'active' | 'paused';
  /** set when this pair was created by turning on the legacy per-folder Auto-Sync toggle on a pinned
   * folder, rather than through the standalone Sync Engine "add a folder" flow — lets the UI show it as
   * belonging to that folder instead of as a free-standing pair. */
  sourceFolderId?: string;
  /** the human-readable name of the machine this pair was created on (e.g. "Vansh's MacBook Pro") — each
   * device runs its own backend with its own local Sync Pair registry, so this is purely informational
   * today (a Mac only ever lists pairs it created itself), but becomes meaningful once cross-device
   * visibility exists (the Windows build this is prepping for). Captured once at creation, not live. */
  sourceDeviceName?: string;
  name: string;
  createdAt: string;
}
