import path from 'node:path';

// overridable so a second local instance can simulate a second physical device in dev/testing.
// In production (spawned by Electron main), ALLIMINATE_DATA_DIR is set to app.getPath('userData').
// In bare Node dev (node dist/index.js), fall back to a directory next to the built dist folder.
const DATA_DIR = process.env.ALLIMINATE_DATA_DIR ?? path.join(__dirname, '..', 'data');

export function dataPath(file: string): string {
  return path.join(DATA_DIR, file);
}
