export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export type FileCategory = 'image' | 'doc' | 'other';

export function categorize(path: string): FileCategory {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return 'image';
  if (['txt', 'doc', 'docx', 'pdf', 'md', 'rtf', 'pages'].includes(ext)) return 'doc';
  return 'other';
}

export type BroadCategory = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

const BROAD_EXT_MAP: Record<string, BroadCategory> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  heic: 'image', heif: 'image', svg: 'image', bmp: 'image', tiff: 'image',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', m4v: 'video', wmv: 'video',
  mp3: 'audio', wav: 'audio', aac: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  csv: 'document', ppt: 'document', pptx: 'document', txt: 'document', md: 'document',
  rtf: 'document', pages: 'document', key: 'document', numbers: 'document',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
};

// Google Docs/Sheets/Slides etc are native cloud files with NO file extension (e.g. "Quarterly Report",
// not "Quarterly Report.docx") — extension-only lookup misses them entirely, so fall back to mimeType.
const MIME_CATEGORY_MAP: Record<string, BroadCategory> = {
  'application/vnd.google-apps.document': 'document',
  'application/vnd.google-apps.spreadsheet': 'document',
  'application/vnd.google-apps.presentation': 'document',
  'application/vnd.google-apps.form': 'document',
  'application/vnd.google-apps.drawing': 'document',
  'application/pdf': 'document',
};

export function broadCategorize(path: string, mimeType?: string): BroadCategory {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (BROAD_EXT_MAP[ext]) return BROAD_EXT_MAP[ext];
  if (mimeType) {
    if (MIME_CATEGORY_MAP[mimeType]) return MIME_CATEGORY_MAP[mimeType];
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
  }
  return 'other';
}

// filenames are attacker-controllable (any file dropped into a shared/synced cloud folder) and the
// activity feed builds its entries as raw HTML strings (bold tags around the filename) rendered via
// dangerouslySetInnerHTML — without this, a file named e.g. `<img src=x onerror=alert(1)>.jpg` injects
// arbitrary markup/script into the renderer the moment it syncs.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
