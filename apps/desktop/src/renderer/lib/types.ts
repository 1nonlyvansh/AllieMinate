import type { FileEntry } from '@alliminate/shared';
export type { SyncPair } from '@alliminate/shared';

export interface FolderMeta {
  id: string;
  name: string;
  /** account id — a bare provider name, or "google-drive:2" etc for extra linked accounts */
  provider: string;
  remotePrefix: string;
  remoteFolderId?: string;
  pinned?: boolean;
  /** Phase 5: Auto-Sync — whether this folder can even offer it (no localPath means it can't). */
  hasLocalPath?: boolean;
  autoSync?: boolean;
  syncTargetKind?: 'cloud' | 'device';
  syncDeviceId?: string;
  syncPaused?: boolean;
}

export interface StatusResponse {
  ok: boolean;
  providers: string[];
  folders: FolderMeta[];
}

export interface ActivityEntry {
  id: string;
  text: string;
  kind: 'synced' | 'deleted' | 'error';
  ts: string;
  folderId?: string;
  fileKey?: string;
  size?: number;
}

export type FilesByFolder = Record<string, FileEntry[]>;

export interface TrashEntry {
  id: string;
  name: string;
  size: number;
  provider: string;
  originalFolderId: string;
  originalKey: string;
  trashKey: string;
  deletedAt: string;
}

export interface PairedDeviceInfo {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  host?: string;
  pairedAt?: string;
  nearbyShareEnabled?: boolean;
}

export interface NearbyPeerInfo {
  id: string;
  name: string;
  platform: string;
  host: string;
  lastSeen: number;
}

export interface RemoteFolder {
  id: string;
  name: string;
  // absent for a local-folder category (Desktop/Downloads/Received/...) — only cloud-backed categories
  // (from /devices/:id/folders, as opposed to /devices/:id/local-folders) have a real provider.
  provider?: string;
}

export interface ClipboardFileItem {
  folderId: string;
  path: string;
  name: string;
  // set only when this item came from a paired device's file browser (RemoteBrowser) — folderId in that
  // case is the device's category id ("images", "videos", ...), not a registered cloud folder id, so
  // paste needs to route through the device-copy backend route instead of the normal folder-to-folder one.
  deviceId?: string;
  mimeType?: string;
}

export type ClipboardEntry =
  | { kind: 'file'; action: 'copy' | 'cut'; items: ClipboardFileItem[] }
  | { kind: 'folder'; action: 'copy' | 'cut'; folderId: string; name: string }
  | null;
