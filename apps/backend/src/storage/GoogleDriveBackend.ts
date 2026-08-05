import { Readable } from 'node:stream';
import { google, drive_v3 } from 'googleapis';
import type { FileEntry, FolderNode } from '@alliminate/shared';
import type { StorageBackend } from './StorageBackend';
import type { GoogleDriveConfig } from '../config';

const ROOT_FOLDER_NAME = 'AllieMinate';
const TRASH_FOLDER_NAME = '.trash';

// server.ts's /files/trash "deletes" a file by renaming it to "_trash/<uuid>__<original name>" — for the
// S3-compatible backends (B2, IDrive e2) that "/" is a real key-prefix, so it genuinely nests the file out
// of sight. Drive has no such thing: a file's `name` field is one flat string, so that same key used to
// get created as a literal file named "_trash/e4a70a55-...__Special Notes.pdf" sitting in the OPEN, right
// next to everything else — fully visible (and confusingly named) in the user's actual My Drive and
// Suggested/Recent lists. Route trash keys into a real, dedicated ".trash" subfolder instead, using just
// the part after "_trash/" as the real filename — same recoverability, none of the clutter.
function trashKeyName(key: string): string | null {
  return key.startsWith('_trash/') ? key.slice('_trash/'.length) : null;
}

function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export class GoogleDriveBackend implements StorageBackend {
  private drive: drive_v3.Drive;
  private rootFolderId: string | null = null;
  private trashFolderId: string | null = null;

  constructor(cfg: GoogleDriveConfig) {
    const auth = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    auth.setCredentials({ refresh_token: cfg.refreshToken });
    this.drive = google.drive({ version: 'v3', auth });
  }

  private async getRootFolderId(): Promise<string> {
    if (this.rootFolderId) return this.rootFolderId;

    const res = await this.drive.files.list({
      q: `name = '${ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    const existing = res.data.files?.[0]?.id;
    if (existing) {
      this.rootFolderId = existing;
      return existing;
    }

    const created = await this.drive.files.create({
      requestBody: { name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });

    this.rootFolderId = created.data.id as string;
    return this.rootFolderId;
  }

  private async getTrashFolderId(): Promise<string> {
    if (this.trashFolderId) return this.trashFolderId;
    const rootId = await this.getRootFolderId();

    const res = await this.drive.files.list({
      q: `name = '${TRASH_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and '${rootId}' in parents and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive',
    });
    const existing = res.data.files?.[0]?.id;
    if (existing) {
      this.trashFolderId = existing;
      return existing;
    }

    const created = await this.drive.files.create({
      requestBody: { name: TRASH_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [rootId] },
      fields: 'id',
    });
    this.trashFolderId = created.data.id as string;
    return this.trashFolderId;
  }

  private async findFileIdInFolder(folderId: string, name: string): Promise<string | null> {
    const escaped = name.replace(/'/g, "\\'");
    const res = await this.drive.files.list({
      q: `name = '${escaped}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive',
    });
    return res.data.files?.[0]?.id ?? null;
  }

  private async findFileIdInRoot(key: string): Promise<string | null> {
    const trashName = trashKeyName(key);
    if (trashName) return this.findFileIdInFolder(await this.getTrashFolderId(), trashName);
    return this.findFileIdInFolder(await this.getRootFolderId(), key);
  }

  private async findFileId(key: string): Promise<string | null> {
    // trash keys are UUID-qualified and only ever live in the dedicated trash folder — no wide fallback
    // needed or wanted for these (unlike a real filename, there's no "pre-existing file the user browsed
    // to" case to cover).
    if (trashKeyName(key)) return this.findFileIdInRoot(key);

    const inRoot = await this.findFileIdInRoot(key);
    if (inRoot) return inRoot;

    // not an AllieMinate-managed file — fall back to a drive-wide name search (covers previewing/opening/
    // deleting a specific pre-existing file the user already selected by browsing listAll()/browseFolder()
    // — those resolve one file the user picked, not a "does this already exist" write decision). NEVER use
    // this wide fallback to decide whether a put() should overwrite something — bare-name-only matching
    // against the WHOLE account risks silently overwriting some unrelated file that just happens to share
    // a name (a rename/move/copy landing on a "*" whole-account view goes through exactly that path).
    const escaped = key.replace(/'/g, "\\'");
    const wide = await this.drive.files.list({
      q: `name = '${escaped}' and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive',
    });
    return wide.data.files?.[0]?.id ?? null;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const trashName = trashKeyName(key);
    const parentId = trashName ? await this.getTrashFolderId() : await this.getRootFolderId();
    const name = trashName ?? key;
    const existingId = await this.findFileIdInRoot(key);
    const media = { mimeType: 'application/octet-stream', body: bufferToStream(data) };

    if (existingId) {
      await this.drive.files.update({ fileId: existingId, media });
    } else {
      await this.drive.files.create({
        requestBody: { name, parents: [parentId] },
        media,
        fields: 'id',
      });
    }
  }

  async get(key: string): Promise<Buffer> {
    const fileId = await this.findFileId(key);
    if (!fileId) throw new Error(`file not found: ${key}`);

    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  async delete(key: string): Promise<void> {
    const fileId = await this.findFileId(key);
    if (!fileId) return;
    await this.drive.files.delete({ fileId });
  }

  /** Drive's own viewer/editor link — works for native Google Docs/Sheets/Slides and for real .docx/.xlsx opened through Drive's editors. */
  async getWebEditUrl(key: string): Promise<string | null> {
    const fileId = await this.findFileId(key);
    if (!fileId) return null;
    const res = await this.drive.files.get({ fileId, fields: 'webViewLink' });
    return res.data.webViewLink ?? null;
  }

  /** Creates a real, empty, user-visible folder at the top level of "My Drive" — purely for the "also
   * create this for real in the cloud" option when pinning a new folder. AllieMinate's own file storage
   * for that pinned folder still goes through the normal flat-prefix scheme inside the app's own hidden
   * root, same as every other folder; this is a standalone visible marker the user can actually see and
   * open in Drive, not a rewire of where AllieMinate's uploads land. */
  async createVisibleFolder(name: string): Promise<void> {
    await this.drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
  }

  /** The account's email — via Drive's own about.get, not the oauth2/userinfo endpoint, so it works with
   * whatever scope this token already has (userinfo.email is a separate consent some older-linked
   * accounts never granted). */
  async getAccountEmail(): Promise<string | undefined> {
    const res = await this.drive.about.get({ fields: 'user' });
    return res.data.user?.emailAddress ?? undefined;
  }

  /** Real account-wide usage (Drive + Photos + Gmail attachments count against the same 15GB pool) — matches what
   * drive.google.com's own storage page shows, unlike summing just the AllieMinate-managed folder. */
  async getAccountUsage(): Promise<{ usedBytes: number; totalBytes: number } | null> {
    const res = await this.drive.about.get({ fields: 'storageQuota' });
    const quota = res.data.storageQuota;
    if (!quota?.usage || !quota.limit) return null; // unlimited (Workspace) accounts report no limit
    return { usedBytes: Number(quota.usage), totalBytes: Number(quota.limit) };
  }

  async list(prefix: string): Promise<FileEntry[]> {
    const rootId = await this.getRootFolderId();
    const res = await this.drive.files.list({
      q: `'${rootId}' in parents and trashed = false`,
      fields: 'files(id, name, size, modifiedTime, createdTime, md5Checksum, mimeType, thumbnailLink)',
      spaces: 'drive',
      pageSize: 1000,
    });

    return (res.data.files ?? [])
      .filter((f) => f.name?.startsWith(prefix))
      .map((f) => ({
        path: f.name ?? '',
        size: Number(f.size ?? 0),
        hash: f.md5Checksum ?? '',
        modifiedAt: f.modifiedTime ?? new Date(0).toISOString(),
        mimeType: f.mimeType ?? undefined,
        createdAt: f.createdTime ?? undefined,
        thumbnailUrl: f.thumbnailLink ?? undefined,
      }));
  }

  /** One level of the account's REAL tree, starting at Drive's actual top level ('root') — not
   * AllieMinate's hidden managed folder. Powers the Finder-style upload destination picker. */
  async browseFolder(folderId: string | null): Promise<{ folders: FolderNode[]; files: FileEntry[] }> {
    const parent = folderId ?? 'root';
    const res = await this.drive.files.list({
      q: `'${parent}' in parents and trashed = false`,
      fields: 'files(id, name, size, modifiedTime, createdTime, md5Checksum, mimeType, thumbnailLink)',
      spaces: 'drive',
      pageSize: 1000,
      orderBy: 'folder,name',
    });
    const items = res.data.files ?? [];
    const folders: FolderNode[] = items
      .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.name !== TRASH_FOLDER_NAME)
      .map((f) => ({ id: f.id as string, name: f.name ?? '' }));
    const files: FileEntry[] = items
      .filter((f) => f.mimeType !== 'application/vnd.google-apps.folder')
      .map((f) => ({
        path: f.name ?? '',
        size: Number(f.size ?? 0),
        hash: f.md5Checksum ?? '',
        modifiedAt: f.modifiedTime ?? new Date(0).toISOString(),
        mimeType: f.mimeType ?? undefined,
        createdAt: f.createdTime ?? undefined,
        thumbnailUrl: f.thumbnailLink ?? undefined,
      }));
    return { folders, files };
  }

  async makeFolder(parentId: string | null, name: string): Promise<FolderNode> {
    const parent = parentId ?? 'root';
    const created = await this.drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
      fields: 'id, name',
    });
    return { id: created.data.id as string, name: created.data.name ?? name };
  }

  /** Unlike a filesystem, Drive happily lets two files share the same name inside the same folder — so
   * an unconditional files.create() here is what actually produces duplicates, not something scanning
   * afterward. A phone-side FileObserver push racing the periodic WorkManager scan (or a Sync Pair
   * re-uploading a file it thinks changed) each just create ANOTHER file with the same name instead of
   * overwriting. Same fix MegaBackend.putInFolder() already got — delete any existing same-name files in
   * this folder first, then create fresh. */
  private async findFilesInFolder(parent: string, name: string): Promise<string[]> {
    const escaped = name.replace(/'/g, "\\'");
    const res = await this.drive.files.list({
      q: `name = '${escaped}' and '${parent}' in parents and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive',
    });
    return (res.data.files ?? []).map((f) => f.id as string).filter(Boolean);
  }

  async putInFolder(folderId: string | null, name: string, data: Buffer): Promise<void> {
    const parent = folderId ?? 'root';
    const existing = await this.findFilesInFolder(parent, name);
    await Promise.all(existing.map((id) => this.drive.files.delete({ fileId: id })));
    await this.drive.files.create({
      requestBody: { name, parents: [parent] },
      media: { mimeType: 'application/octet-stream', body: bufferToStream(data) },
      fields: 'id',
    });
  }

  /** True stream-through upload — Drive's resumable upload protocol (what googleapis uses under the hood
   * whenever media.body is a stream) needs no upfront Content-Length, so the request body coming in from
   * the client can be piped straight to Drive without ever landing in a single in-memory Buffer here. This
   * is what keeps a multi-GB phone-to-cloud share from timing out mid-transfer the way full-buffer-then-
   * forward could for very large files. */
  async putStreamInFolder(folderId: string | null, name: string, stream: Readable): Promise<void> {
    const parent = folderId ?? 'root';
    const existing = await this.findFilesInFolder(parent, name);
    await Promise.all(existing.map((id) => this.drive.files.delete({ fileId: id })));
    await this.drive.files.create({
      requestBody: { name, parents: [parent] },
      media: { mimeType: 'application/octet-stream', body: stream },
      fields: 'id',
    });
  }

  /** Every non-trashed file in the whole Drive account, including ones AllieMinate never touched. Requires the broader `drive` scope — `drive.file` only returns app-created files and will yield an empty/partial list. */
  async listAll(): Promise<FileEntry[]> {
    const files: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    // trashed files now live in a real ".trash" subfolder (see trashKeyName) with their real filename
    // restored — no "_trash/" prefix left in the name to filter on the way withoutTrash() does for other
    // providers, so they'd otherwise leak straight back into every whole-account listing (Cloud Services
    // "All Files", /recent's fallback, /search) as if they were never deleted. Exclude by parent instead.
    const trashId = await this.getTrashFolderId();

    do {
      const res = await this.drive.files.list({
        q: `trashed = false and mimeType != 'application/vnd.google-apps.folder' and not '${trashId}' in parents`,
        fields: 'nextPageToken, files(id, name, size, modifiedTime, createdTime, md5Checksum, mimeType, thumbnailLink)',
        spaces: 'drive',
        pageSize: 1000,
        pageToken,
      });
      files.push(...(res.data.files ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return files.map((f) => ({
      path: f.name ?? '',
      size: Number(f.size ?? 0),
      hash: f.md5Checksum ?? '',
      modifiedAt: f.modifiedTime ?? new Date(0).toISOString(),
      mimeType: f.mimeType ?? undefined,
      createdAt: f.createdTime ?? undefined,
      thumbnailUrl: f.thumbnailLink ?? undefined,
    }));
  }
}
