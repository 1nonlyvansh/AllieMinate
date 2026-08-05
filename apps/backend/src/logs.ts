import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dataPath } from './paths';
import { loadUsername } from './username';

export interface LogMeta {
  id: string;
  kind: 'user' | 'automated';
  os: string;
  username: string;
  description: string;
  createdAt: string;
  imageCount: number;
}

function logsRoot(): string {
  const username = loadUsername() ?? 'unknown';
  return dataPath(path.join('Users', username, 'Logs'));
}

function osLabel(): string {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'Windows';
  return process.platform;
}

// filesystem-safe timestamp — colons in ISO strings aren't valid in folder names on every OS.
function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function metaPath(dir: string): string {
  return path.join(dir, 'meta.json');
}

/** Saves a user-submitted error report: description + up to 5 images, capped to 5 regardless of what's
 * passed in (matches the Settings UI's own 5-image limit — enforced again here since this is also a real
 * API boundary, not just a UI constraint). */
export function saveUserLog(description: string, images: { name: string; dataUrl: string }[]): LogMeta {
  const root = logsRoot();
  fs.mkdirSync(root, { recursive: true });

  const id = timestampSlug();
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });

  const capped = images.slice(0, 5);
  capped.forEach((img, i) => {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(img.dataUrl);
    if (!match) return;
    const ext = match[1].split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    fs.writeFileSync(path.join(dir, `image-${i}.${ext}`), Buffer.from(match[2], 'base64'));
  });

  const meta: LogMeta = {
    id,
    kind: 'user',
    os: osLabel(),
    username: loadUsername() ?? 'unknown',
    description,
    createdAt: new Date().toISOString(),
    imageCount: capped.length,
  };
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2));
  return meta;
}

/** Backend-detected problems (e.g. "was unreachable, main process had to restart it N times") — no
 * images, description is a system-generated message rather than something the user typed. */
export function recordAutomatedLog(message: string): LogMeta {
  const root = logsRoot();
  fs.mkdirSync(root, { recursive: true });

  const id = `AUTOMATED_LOG_${timestampSlug()}`;
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });

  const meta: LogMeta = {
    id,
    kind: 'automated',
    os: osLabel(),
    username: loadUsername() ?? 'unknown',
    description: message,
    createdAt: new Date().toISOString(),
    imageCount: 0,
  };
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2));
  return meta;
}

export function listLogs(): LogMeta[] {
  const root = logsRoot();
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  const logs: LogMeta[] = [];
  for (const entry of entries) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath(path.join(root, entry.name)), 'utf-8'));
      logs.push(meta);
    } catch {
      // a folder without a readable meta.json isn't a real log entry — skip it
    }
  }
  return logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Real attachable files for a log — everything except the internal meta.json bookkeeping file. */
export function listLogImages(id: string): string[] {
  const dir = path.join(logsRoot(), id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name !== 'meta.json')
    .map((name) => path.join(dir, name));
}

export function getLogDir(id: string): string | null {
  const root = logsRoot();
  const dir = path.join(root, id);
  return fs.existsSync(dir) ? dir : null;
}

export { logsRoot };
