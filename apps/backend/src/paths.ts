import path from 'node:path';

// overridable so a second local instance can simulate a second physical device in dev/testing.
const DATA_DIR = process.env.ALLIMINATE_DATA_DIR ?? path.join(__dirname, '..');

export function dataPath(file: string): string {
  return path.join(DATA_DIR, file);
}
