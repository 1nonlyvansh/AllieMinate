import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPath } from './paths';

const SETTINGS_PATH = dataPath('sounds-settings.json');

export function defaultSoundsFolder(): string {
  return path.join(os.homedir(), 'Music', 'AllieMinate Sounds');
}

interface SoundsSettings {
  enabled: boolean;
  folder: string;
}

function load(): SoundsSettings {
  if (!fs.existsSync(SETTINGS_PATH)) return { enabled: true, folder: defaultSoundsFolder() };
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return {
      enabled: data.enabled !== false,
      folder: typeof data.folder === 'string' && data.folder.trim() ? data.folder : defaultSoundsFolder(),
    };
  } catch {
    return { enabled: true, folder: defaultSoundsFolder() };
  }
}

function save(settings: SoundsSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

export function loadAlertSoundsEnabled(): boolean {
  return load().enabled;
}

export function setAlertSoundsEnabled(enabled: boolean): void {
  save({ ...load(), enabled });
}

export function loadSoundsFolder(): string {
  return load().folder;
}

export function saveSoundsFolder(folder: string): void {
  save({ ...load(), folder });
}
