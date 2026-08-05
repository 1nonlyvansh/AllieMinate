import fs from 'node:fs';
import { dataPath } from './paths';

const MASTER_PATH = dataPath('masterDevice.json');

export function loadMasterDeviceEnabled(): boolean {
  if (!fs.existsSync(MASTER_PATH)) return true;
  return JSON.parse(fs.readFileSync(MASTER_PATH, 'utf-8')).enabled !== false;
}

export function setMasterDeviceEnabled(enabled: boolean): void {
  fs.writeFileSync(MASTER_PATH, JSON.stringify({ enabled }, null, 2));
}
