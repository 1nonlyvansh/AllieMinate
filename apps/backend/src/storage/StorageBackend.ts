import type { Readable } from 'node:stream';
import type { FileEntry, FolderNode } from '@alliminate/shared';

export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<FileEntry[]>;
  /** Lists every file in the account, not just ones under this app's managed prefix. Read-only. */
  listAll?(): Promise<FileEntry[]>;
  /** Web-editable link (Google Docs/Sheets/Slides, Office Online) for a file already in this account, if the provider supports it. */
  getWebEditUrl?(key: string): Promise<string | null>;
  /** Real account-wide storage usage (not just AllieMinate's own managed folder) — for providers where the account is
   * shared with other apps/uses (Drive, OneDrive), summing our own folder wildly understates real usage. */
  getAccountUsage?(): Promise<{ usedBytes: number; totalBytes: number } | null>;
  /** Creates a real, empty, user-visible folder in the actual cloud account (not just an AllieMinate-side
   * config) — only meaningful for providers with real folder objects (Drive). */
  createVisibleFolder?(name: string): Promise<void>;
  /** The account owner's email, when the provider can report it without needing a broader OAuth scope
   * than what's already granted (Drive's about.get includes it for free). */
  getAccountEmail?(): Promise<string | undefined>;

  /** Finder-style browse of the account's REAL raw tree (not AllieMinate's managed prefix) — one level at
   * a time. `folderId: null` means the account's top level. Id shape is provider-specific (Drive/OneDrive:
   * object id; S3-compatible: key prefix ending in "/"; Mega: node id; pCloud: folderid as a string). */
  browseFolder?(folderId: string | null): Promise<{ folders: FolderNode[]; files: FileEntry[] }>;
  /** Creates a real folder inside the given parent (null = top level) as part of that same raw tree. */
  makeFolder?(parentId: string | null, name: string): Promise<FolderNode>;
  /** Uploads into a specific folder from browseFolder/makeFolder (null = top level) — distinct from
   * put(), which always targets AllieMinate's own hidden managed root regardless of what the user browsed to. */
  putInFolder?(folderId: string | null, name: string, data: Buffer): Promise<void>;
  /** True streaming counterpart to putInFolder — pipes the request body straight through without ever
   * buffering the whole file in Node memory first. Only implemented where the provider's own SDK genuinely
   * accepts a Readable body (Drive's resumable upload protocol needs no upfront Content-Length); providers
   * without a working streaming path just don't implement this, and callers fall back to putInFolder. */
  putStreamInFolder?(folderId: string | null, name: string, stream: Readable): Promise<void>;
}
