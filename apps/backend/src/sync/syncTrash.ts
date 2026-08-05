import fs from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from '../paths';

// Two-way sync means an accidental local delete propagates and removes the cloud copy too — the existing
// conflict-copy mechanism protects EDITS from being silently lost, but until this file existed, a delete
// had no equivalent safety net. Both delete-propagation directions in twoWaySync.ts route through here
// instead of calling fs.unlink / target.delete directly, so the "other side's" copy always lands in a
// local holding folder first rather than vanishing outright.
const TRASH_RETENTION_DAYS = 7;

function trashDir(scopeId: string): string {
  return dataPath(`syncTrash/${scopeId}`);
}

function trashFileName(relPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}__${relPath.replace(/\//g, '__')}`;
}

/** Local file about to be deleted because the remote copy is gone — moved into trash instead of unlinked. */
export async function trashLocalFile(scopeId: string, relPath: string, localAbsPath: string): Promise<void> {
  const dir = trashDir(scopeId);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, trashFileName(relPath));
  await fs.rename(localAbsPath, dest).catch(async () => {
    // cross-device rename can fail — fall back to copy+unlink
    const data = await fs.readFile(localAbsPath);
    await fs.writeFile(dest, data);
    await fs.unlink(localAbsPath).catch(() => {});
  });
}

/** Remote bytes about to be deleted because the local copy is gone — fetched and stashed before the
 * target.delete() call, since there's no remote-side trash to move them to instead. */
export async function trashRemoteBytes(scopeId: string, relPath: string, data: Buffer): Promise<void> {
  const dir = trashDir(scopeId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, trashFileName(relPath)), data);
}

/** Startup + daily sweep, not run per-reconciliation-pass — purges anything past the retention window. */
export async function purgeOldSyncTrash(): Promise<void> {
  const root = dataPath('syncTrash');
  let scopes: string[];
  try {
    scopes = await fs.readdir(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const scope of scopes) {
    const dir = path.join(root, scope);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) await fs.unlink(full);
      } catch {
        // already gone between readdir and stat — fine, that's the goal anyway
      }
    }
  }
}
