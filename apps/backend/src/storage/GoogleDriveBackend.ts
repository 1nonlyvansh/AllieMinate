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

// The two fixed top-level segments every NEW sync/Universal-Sync remotePrefix is generated under (see
// server.ts's POST /folders and syncPairs.ts's POST /sync/pairs) — real nested Drive folders from here on.
// Any OTHER key/prefix — every folder created before this migration, an opaque slug like "wallpapers-a1b2c3"
// with no "Sync/"/"Universal Sync/" segment — is a pre-existing folder that still stores its files the old
// way: one flat literal filename equal to the whole key, sitting directly in the managed root. Never
// migrated in place (that would mean silently moving a user's existing files mid-flight); this flag just
// picks which of the two storage shapes a given key/prefix already lives under, on both the read and write
// side, so an old folder keeps working exactly as it always has forever, and only brand-new folders get the
// real nested treatment. Drive filenames can never contain "/", so this check can never misfire on a
// coincidental prefix collision with a real single-segment Drive filename.
const NEW_SCHEME_ROOTS = ['Sync/', 'Universal Sync/'];
function isNewSchemeKey(keyOrPrefix: string): boolean {
  return NEW_SCHEME_ROOTS.some((root) => keyOrPrefix.startsWith(root));
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
  // findFileId() otherwise costs a real files.list round-trip on EVERY get()/delete() — including every
  // inline preview open — before the actual content request even starts. Safe to cache: put() on an
  // existing key overwrites in place via files.update (same fileId survives), so the only place a cached
  // id actually goes stale is delete(), which clears its own entry below.
  private fileIdCache = new Map<string, string>();
  // relative folder path ("" = the managed root itself) -> its real Drive folder id. A key like
  // "Sync/Personal/college/marksheet.pdf" now maps to real nested Drive folders (Sync/Personal/college)
  // instead of one flat file literally named that whole string — this cache is what keeps resolving/
  // creating that folder chain to a single lookup per segment instead of one per put()/get()/delete() call.
  private folderPathCache = new Map<string, string>();

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

  /** Resolves a relative folder path ("" = the managed root itself, "Sync/Personal" = a real two-level
   * nested folder under it) to its Drive folder id, walking/caching one segment at a time. `create` decides
   * what a missing segment means: `true` creates it (a put() needs somewhere to put the file), `false`
   * treats it as "genuinely nothing here yet" and returns null (a get()/list() has nothing to find or
   * create). Drive names can't contain "/" at all, so any key reaching this with a slash in it is always
   * one of AllieMinate's own synthetic multi-segment paths, never a real ambiguous Drive filename. */
  private async resolveFolderId(relDir: string, create: boolean): Promise<string | null> {
    if (!relDir) return this.getRootFolderId();
    const cached = this.folderPathCache.get(relDir);
    if (cached) return cached;

    let parentId = await this.getRootFolderId();
    let builtPath = '';
    for (const segment of relDir.split('/').filter(Boolean)) {
      builtPath = builtPath ? `${builtPath}/${segment}` : segment;
      const cachedSegment = this.folderPathCache.get(builtPath);
      if (cachedSegment) {
        parentId = cachedSegment;
        continue;
      }
      const escaped = segment.replace(/'/g, "\\'");
      const res = await this.drive.files.list({
        q: `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive',
      });
      let id = res.data.files?.[0]?.id;
      if (!id) {
        if (!create) return null;
        const created = await this.drive.files.create({
          requestBody: { name: segment, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
          fields: 'id',
        });
        id = created.data.id as string;
      }
      this.folderPathCache.set(builtPath, id);
      parentId = id;
    }
    return parentId;
  }

  /** Splits a key like "Sync/Personal/college/marksheet.pdf" into its real parent folder path
   * ("Sync/Personal/college") and real filename ("marksheet.pdf") — the last "/" is the only one that
   * matters, everything before it is folder structure now instead of being crammed into one flat name. A
   * key with no "/" at all (a root-level file, or a whole-account key found via browseFolder/listAll) has
   * no dir component. */
  private splitKey(key: string): { dir: string; name: string } {
    const slash = key.lastIndexOf('/');
    return slash === -1 ? { dir: '', name: key } : { dir: key.slice(0, slash), name: key.slice(slash + 1) };
  }

  private async findFileId(key: string): Promise<string | null> {
    const cached = this.fileIdCache.get(key);
    if (cached) return cached;
    const resolved = await this.findFileIdUncached(key);
    if (resolved) this.fileIdCache.set(key, resolved);
    return resolved;
  }

  private async findFileIdUncached(key: string): Promise<string | null> {
    const trashName = trashKeyName(key);
    // trash keys are UUID-qualified and only ever live in the dedicated trash folder — no wide fallback
    // needed or wanted for these (unlike a real filename, there's no "pre-existing file the user browsed
    // to" case to cover).
    if (trashName) return this.findFileIdInFolder(await this.getTrashFolderId(), trashName);

    if (isNewSchemeKey(key)) {
      // a real nested sync path — resolved entirely within its own real folder chain, no root/wide
      // fallback: this key was only ever going to be found here or nowhere.
      const { dir, name } = this.splitKey(key);
      const folderId = await this.resolveFolderId(dir, false);
      return folderId ? this.findFileIdInFolder(folderId, name) : null;
    }

    // legacy flat scheme (or a root-level/whole-account key with no "/" at all) — unchanged from before
    // real nesting existed: the whole key is the literal filename, sitting directly in the managed root.
    const inRoot = await this.findFileIdInFolder(await this.getRootFolderId(), key);
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
    const media = { mimeType: 'application/octet-stream', body: bufferToStream(data) };

    let parentId: string;
    let name: string;
    if (trashName) {
      parentId = await this.getTrashFolderId();
      name = trashName;
    } else if (isNewSchemeKey(key)) {
      const split = this.splitKey(key);
      const resolved = await this.resolveFolderId(split.dir, true);
      if (!resolved) throw new Error(`couldn't resolve or create the destination folder for: ${key}`);
      parentId = resolved;
      name = split.name;
    } else {
      // legacy flat scheme — the whole key becomes the literal filename at the managed root, exactly as
      // it always has for any folder created before real nesting existed.
      parentId = await this.getRootFolderId();
      name = key;
    }

    const existingId = await this.findFileId(key);
    if (existingId) {
      await this.drive.files.update({ fileId: existingId, media });
      this.fileIdCache.set(key, existingId);
    } else {
      const created = await this.drive.files.create({
        requestBody: { name, parents: [parentId] },
        media,
        fields: 'id',
      });
      if (created.data.id) this.fileIdCache.set(key, created.data.id);
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

  /** googleapis supports responseType:'stream' on the exact same call get() already makes — the request
   * itself doesn't get any faster, but the caller (a download route) can start forwarding bytes to the
   * client as they arrive instead of waiting for the entire file to land in memory here first. */
  async getStream(key: string): Promise<Readable> {
    const fileId = await this.findFileId(key);
    if (!fileId) throw new Error(`file not found: ${key}`);

    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' },
    );
    return res.data as unknown as Readable;
  }

  async delete(key: string): Promise<void> {
    const fileId = await this.findFileId(key);
    if (!fileId) return;
    await this.drive.files.delete({ fileId });
    this.fileIdCache.delete(key);
  }

  /** Drive's own viewer/editor link — works for native Google Docs/Sheets/Slides and for real .docx/.xlsx opened through Drive's editors. */
  async getWebEditUrl(key: string): Promise<string | null> {
    const fileId = await this.findFileId(key);
    if (!fileId) return null;
    const res = await this.drive.files.get({ fileId, fields: 'webViewLink' });
    return res.data.webViewLink ?? null;
  }

  /** Creates a real, empty, user-visible folder for the "also create this for real in the cloud" option
   * (Sync Pairs and pinned/auto-sync folders both offer it) — at the SAME nested location
   * (AllieMinate/Sync/<name> or AllieMinate/Universal Sync/<name>) that this pair's own files actually
   * land at via put()/list()'s resolveFolderId, not an independent top-level marker. `relPath` is the
   * caller's already-computed remotePrefix (e.g. "Sync/Test Sync for Google Drive"), so opening the
   * visible folder in Drive shows exactly the files AllieMinate puts there — no separate empty folder
   * sitting unexplained at My Drive's root next to the real one. */
  async createVisibleFolder(relPath: string): Promise<void> {
    await this.resolveFolderId(relPath, true);
  }

  /** Trashes (soft-delete, recoverable from Drive's own Trash — same reversibility every other delete in
   * this app already gives the user) the visible folder createVisibleFolder made for this relPath, and
   * everything inside it. `create: false` — never invent the folder just to immediately trash it. */
  async deleteVisibleFolder(relPath: string): Promise<void> {
    const fileId = await this.resolveFolderId(relPath, false);
    if (!fileId) return;
    await this.drive.files.update({ fileId, requestBody: { trashed: true } });
    this.folderPathCache.delete(relPath);
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

  // pageSize:1000 alone silently truncates at a folder's first 1000 items — with every sync folder sharing
  // space under one real Drive tree, a single deeply-nested folder could still hit that. A truncated list
  // here looks EXACTLY like "everything past item 1000 was deleted remotely" to the sync engine, which then
  // deletes the corresponding local copies to "honor" that phantom delete. Must page through every result,
  // not just the first batch — same reasoning as listAll() below.
  private async walkFolder(folderId: string, relPrefix: string, out: FileEntry[]): Promise<void> {
    const subfolders: { id: string; name: string }[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, size, modifiedTime, createdTime, md5Checksum, mimeType, thumbnailLink)',
        spaces: 'drive',
        pageSize: 1000,
        pageToken,
      });
      for (const f of res.data.files ?? []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          subfolders.push({ id: f.id as string, name: f.name ?? '' });
          continue;
        }
        out.push({
          path: relPrefix ? `${relPrefix}/${f.name}` : (f.name ?? ''),
          size: Number(f.size ?? 0),
          hash: f.md5Checksum ?? '',
          modifiedAt: f.modifiedTime ?? new Date(0).toISOString(),
          mimeType: f.mimeType ?? undefined,
          createdAt: f.createdTime ?? undefined,
          thumbnailUrl: f.thumbnailLink ?? undefined,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    for (const sf of subfolders) {
      await this.walkFolder(sf.id, relPrefix ? `${relPrefix}/${sf.name}` : sf.name, out);
    }
  }

  /** Everything under a real nested folder path (e.g. "Sync/Personal") — recursing into whatever real
   * subfolders exist there, matching however deep the local folder tree being synced actually goes. Returns
   * `path` as the full relative path from the managed root ("Sync/Personal/college/marksheet.pdf"), same
   * shape the (still flat, for pre-existing folders created before this) name-prefix scheme returned, so
   * callers stripping `folder.remotePrefix` off the front don't need to change. */
  async list(prefix: string): Promise<FileEntry[]> {
    const out: FileEntry[] = [];

    if (isNewSchemeKey(prefix)) {
      const folderId = await this.resolveFolderId(prefix, false);
      if (folderId) await this.walkFolder(folderId, prefix, out);
      return out;
    }

    // legacy flat scheme — every pre-existing sync folder stored its files as one flat root-level filename
    // literally starting with "<prefix>/" (prefix was an opaque single-segment slug, e.g. "wallpapers-a1b2c3",
    // never a real Drive folder). Returning [] here instead of scanning for them is exactly the bug that
    // caused real data loss before: an old folder's files look "deleted" and the sync engine trashes the
    // local copies to match. Unchanged from before this migration, beyond the pagination fix already applied.
    const rootId = await this.getRootFolderId();
    let pageToken: string | undefined;
    do {
      const res = await this.drive.files.list({
        q: `'${rootId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, name, size, modifiedTime, createdTime, md5Checksum, mimeType, thumbnailLink)',
        spaces: 'drive',
        pageSize: 1000,
        pageToken,
      });
      for (const f of res.data.files ?? []) {
        if (!f.name?.startsWith(prefix)) continue;
        out.push({
          path: f.name,
          size: Number(f.size ?? 0),
          hash: f.md5Checksum ?? '',
          modifiedAt: f.modifiedTime ?? new Date(0).toISOString(),
          mimeType: f.mimeType ?? undefined,
          createdAt: f.createdTime ?? undefined,
          thumbnailUrl: f.thumbnailLink ?? undefined,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return out;
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
