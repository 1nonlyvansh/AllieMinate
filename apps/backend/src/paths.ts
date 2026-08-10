import path from 'node:path';

// Everything persistent (accounts.json, devices.json, folders.json, username.json, syncPairs.json, .env —
// every file dataPath()/envPath() below ever touches) lives here. main/index.ts sets ALLIMINATE_DATA_DIR
// to Electron's app.getPath('userData') before spawning this process specifically so a fresh install of a
// newer .app bundle over an old one never touches it: userData sits OUTSIDE the .app bundle (in
// ~/Library/Application Support on macOS, %APPDATA% on Windows), while Finder/Explorer replacing an app
// deletes and recreates the WHOLE bundle atomically. Before this, the fallback below (bundle-relative,
// __dirname walked up to the packaged Resources folder) was the ONLY location ever used — every piece of
// user data lived inside the very bundle a fresh install replaces, which is real data loss on update, not
// hypothetical (paired devices, linked cloud accounts, pinned/sync folders, the OAuth tokens in .env — all
// of it). The fallback still matters for unpackaged dev runs (`npm run dev`, no Electron parent setting the
// env var) and as a same-machine migration source — see migrateLegacyDataDir() in main/index.ts, which
// copies anything still sitting at this old path into the new one on first launch under the new scheme.
export const LEGACY_DATA_DIR = path.join(__dirname, '..');
// overridable so a second local instance can simulate a second physical device in dev/testing.
const DATA_DIR = process.env.ALLIMINATE_DATA_DIR ?? LEGACY_DATA_DIR;

export function dataPath(file: string): string {
  return path.join(DATA_DIR, file);
}

export function envPath(): string {
  return path.join(DATA_DIR, '.env');
}
