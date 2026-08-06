import fs from 'node:fs';
import { dataPath } from './paths';

const PREFS_PATH = dataPath('open-with.json');

export type OpenWithCategory = 'pdf' | 'docx' | 'spreadsheet' | 'pptx' | 'image' | 'video' | 'audio';

export const EXT_TO_CATEGORY: Record<string, OpenWithCategory> = {
  pdf: 'pdf',
  doc: 'docx',
  docx: 'docx',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  csv: 'spreadsheet',
  ppt: 'pptx',
  pptx: 'pptx',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  heif: 'image',
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  webm: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  aac: 'audio',
  flac: 'audio',
  m4a: 'audio',
  ogg: 'audio',
};

// native cloud files (and some phone-recorded videos) can genuinely have no file extension at all in
// their stored name — "open" with no extension falls back unpredictably on macOS (often TextEdit, which
// then shows a video/binary file's raw bytes as garbled text). MIME type from the provider is the
// fallback source of truth when the name itself has nothing to go on.
const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
};

export function extFromMime(mimeType: string): string | null {
  return MIME_TO_EXT[mimeType] ?? null;
}

export function categoryForFile(name: string, mimeType?: string): OpenWithCategory | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (EXT_TO_CATEGORY[ext]) return EXT_TO_CATEGORY[ext];
  const mimeExt = mimeType ? extFromMime(mimeType) : null;
  return mimeExt ? EXT_TO_CATEGORY[mimeExt] ?? null : null;
}

// categories where "open with the browser" is a genuinely useful option (pdf viewable inline, images
// viewable inline) — office formats need a real editor, a browser tab won't render them.
export const BROWSER_ELIGIBLE: OpenWithCategory[] = ['pdf', 'image'];

export function loadOpenWithPrefs(): Partial<Record<OpenWithCategory, string>> {
  if (!fs.existsSync(PREFS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveOpenWithPref(category: OpenWithCategory, appPath: string | null): void {
  const prefs = loadOpenWithPrefs();
  if (appPath) prefs[category] = appPath;
  else delete prefs[category];
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}

// app-detection is a fundamentally different mechanism per OS (macOS: LaunchServices/.app bundles under
// /Applications; Windows: registry file associations, no equivalent bundle directory) — everything above
// this line is OS-agnostic (categories, prefs storage); getAvailableApps is the one function that isn't.
export const getAvailableApps: (category: OpenWithCategory) => { name: string; path: string }[] =
  process.platform === 'win32'
    ? require('./openWith.win').getAvailableApps
    : require('./openWith.mac').getAvailableApps;
