import type { FastifyInstance } from 'fastify';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { listLocalFolders, findLocalFolder, addCustomFolder, removeCustomFolder, isAllowedLocalFolderPath } from '../localFolders';
import { guessMime } from '../localFiles';
import { emitSyncEvent } from '../events';

// flat, top-level-only per folder — same "not a full disk crawl" tradeoff localFiles.ts's recent-files
// scan already makes, for the same reason (stays fast even on a Desktop/Downloads with thousands of
// items). Not a Category/MediaStore split like Android's walk — v1 scope is "browse a real OS folder,"
// not a full recursive filesystem browser.
const MAX_PER_FOLDER = 500;

interface LocalFileEntry {
  path: string;
  size: number;
  hash: string;
  modifiedAt: string;
  mimeType?: string;
}

export function registerLocalFolderRoutes(app: FastifyInstance): void {
  // peer-facing category list — mirrors Android's LocalHttpServer /status folders shape (id + name only,
  // real paths never leave this device).
  app.get('/local-folders', async () => ({
    folders: listLocalFolders().map((f) => ({ id: f.id, name: f.name, builtin: f.builtin })),
  }));

  // shortcut management is never proxied — a device only manages its OWN shortcuts, never a peer's.
  app.post<{ Body: { name: string; path: string } }>('/local-folders/custom', async (req, reply) => {
    const { name, path: folderPath } = req.body;
    if (!folderPath?.trim()) return reply.code(400).send({ error: 'missing path' });
    try {
      const folder = addCustomFolder(name ?? '', folderPath);
      return { ok: true, folder: { id: folder.id, name: folder.name } };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete<{ Params: { id: string } }>('/local-folders/custom/:id', async (req) => {
    removeCustomFolder(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/local-folders/:id/files', async (req, reply) => {
    const folder = findLocalFolder(req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });

    // ?path= is a relative subpath WITHIN this folder (e.g. "Screenshots" or "Screenshots/2026") — lets the
    // browser navigate into real subfolders instead of only ever seeing this folder's top level, which
    // previously silently dropped every subdirectory (Desktop/Downloads/etc routinely have most of their
    // actual content one level down, e.g. under a "Personal" or "Screenshots" folder).
    const subPath = req.query.path ?? '';
    const dirPath = subPath ? path.join(folder.path, subPath) : folder.path;
    if (!isAllowedLocalFolderPath(dirPath)) return reply.code(403).send({ error: 'path not allowed' });

    let names: string[];
    try {
      names = await fsp.readdir(dirPath);
    } catch (err) {
      // non-fatal per-folder, same as Android's per-category error surfacing — a permission error on one
      // folder shouldn't read as "this whole feature is broken."
      return { files: [], folders: [], path: subPath, error: err instanceof Error ? err.message : String(err) };
    }

    const files: LocalFileEntry[] = [];
    const folders: { name: string; path: string }[] = [];
    for (const name of names.slice(0, MAX_PER_FOLDER)) {
      if (name.startsWith('.')) continue;
      const full = path.join(dirPath, name);
      const relPath = subPath ? `${subPath}/${name}` : name;
      try {
        const stat = await fsp.stat(full);
        if (stat.isDirectory()) {
          folders.push({ name, path: relPath });
        } else if (stat.isFile()) {
          files.push({ path: relPath, size: stat.size, hash: '', modifiedAt: stat.mtime.toISOString(), mimeType: guessMime(name) });
        }
      } catch {
        // vanished between readdir and stat — skip it
      }
    }
    files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    folders.sort((a, b) => a.name.localeCompare(b.name));
    return { files, folders, path: subPath };
  });

  app.get<{ Params: { id: string }; Querystring: { key: string } }>('/local-folders/:id/download', async (req, reply) => {
    const folder = findLocalFolder(req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const filePath = path.join(folder.path, req.query.key);
    if (!isAllowedLocalFolderPath(filePath)) return reply.code(403).send({ error: 'path not allowed' });
    try {
      const data = await fsp.readFile(filePath);
      reply.header('Content-Type', 'application/octet-stream');
      return reply.send(data);
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.post<{ Params: { id: string }; Querystring: { name: string; from?: string } }>('/local-folders/:id/upload', async (req, reply) => {
    const folder = findLocalFolder(req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const name = req.query.name;
    if (!name) return reply.code(400).send({ error: 'missing ?name=' });
    const filePath = path.join(folder.path, name);
    if (!isAllowedLocalFolderPath(filePath)) return reply.code(403).send({ error: 'path not allowed' });

    const data = req.body as Buffer;
    await fsp.writeFile(filePath, data);
    emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: name, size: data.length } });
    return { ok: true, key: name, size: data.length };
  });

  app.delete<{ Params: { id: string }; Querystring: { key: string } }>('/local-folders/:id/file', async (req, reply) => {
    const folder = findLocalFolder(req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const filePath = path.join(folder.path, req.query.key);
    if (!isAllowedLocalFolderPath(filePath)) return reply.code(403).send({ error: 'path not allowed' });
    try {
      await fsp.unlink(filePath);
      emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: req.query.key, deleted: true } });
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.patch<{ Params: { id: string }; Querystring: { key: string; newName: string } }>('/local-folders/:id/file', async (req, reply) => {
    const folder = findLocalFolder(req.params.id);
    if (!folder) return reply.code(404).send({ error: 'folder not found' });
    const { key, newName } = req.query;
    if (!key || !newName || newName.includes('/') || newName.includes('\\')) return reply.code(400).send({ error: 'invalid name' });
    const oldPath = path.join(folder.path, key);
    const newPath = path.join(folder.path, newName);
    if (!isAllowedLocalFolderPath(oldPath) || !isAllowedLocalFolderPath(newPath)) return reply.code(403).send({ error: 'path not allowed' });
    try {
      await fsp.rename(oldPath, newPath);
      emitSyncEvent({ type: 'file-synced', folderId: folder.id, payload: { key: newName, renamedFrom: key } });
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });
}
