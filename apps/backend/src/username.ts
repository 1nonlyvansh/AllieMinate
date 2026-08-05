import fs from 'node:fs';
import { dataPath } from './paths';

const SETTINGS_PATH = dataPath('username.json');

export function loadUsername(): string | null {
  if (!fs.existsSync(SETTINGS_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return typeof data.username === 'string' && data.username.trim() ? data.username.trim() : null;
  } catch {
    return null;
  }
}

export function saveUsername(username: string): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ username: username.trim() }, null, 2));
}
