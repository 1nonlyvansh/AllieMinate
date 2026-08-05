import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPath } from './paths';

const SETTINGS_PATH = dataPath('receive-settings.json');

export function defaultReceivePath(): string {
  return path.join(os.homedir(), 'Downloads', 'AllieMinate', 'Transferred from Phone');
}

export function loadReceivePath(): string {
  if (!fs.existsSync(SETTINGS_PATH)) return defaultReceivePath();
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return typeof data.path === 'string' && data.path.trim() ? data.path : defaultReceivePath();
  } catch {
    return defaultReceivePath();
  }
}

export function saveReceivePath(newPath: string): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ path: newPath }, null, 2));
}
