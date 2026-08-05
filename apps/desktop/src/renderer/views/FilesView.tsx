import React, { useEffect, useMemo, useState } from 'react';
import type { FileEntry, ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import type { FolderMeta, FilesByFolder, ClipboardEntry, ClipboardFileItem } from '../lib/types';
import { formatBytes, categorize, broadCategorize, BroadCategory } from '../lib/format';
import { IconSearch, IconGrid, IconList } from '../icons';
import type { MenuItem } from '../components/DropdownMenu';
import { DropdownMenu } from '../components/DropdownMenu';
import { ContextMenu } from '../components/ContextMenu';
import { PreviewModal } from '../components/PreviewModal';
import { RenameModal } from '../components/RenameModal';
import { DestinationPickerModal } from '../components/DestinationPickerModal';
import { ProviderPickerModal } from '../components/ProviderPickerModal';
import { FileDetailsModal } from '../components/FileDetailsModal';
import { ProgressModal } from '../components/ProgressModal';
import { Thumbnail } from '../components/Thumbnail';
import { Skeleton } from '../components/Skeleton';
import { runWithProgress } from '../lib/batch';
import { resolveDestNames } from '../lib/duplicateCheck';
import { copyFileToClipboard } from '../lib/copyToClipboard';
import { pasteClipboardItem } from '../lib/pasteFile';
import { usePairedDevices, buildSendMenuItems, SendableFile } from '../lib/sendActions';
import { NearbyPickerModal } from '../components/NearbyPickerModal';

interface Row extends FileEntry {
  uid: string;
  folderId: string;
  folderName: string;
  provider: string;
}

type SortKey = 'path' | 'size' | 'modifiedAt' | 'type';
type PendingAction =
  | { kind: 'rename' | 'details'; row: Row }
  | { kind: 'copy' | 'move'; items: ClipboardFileItem[] }
  | null;

const API_BASE = 'http://localhost:4310';

const TYPE_FILTER_OPTIONS: { value: 'all' | BroadCategory; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documents' },
  { value: 'archive', label: 'Archives' },
  { value: 'other', label: 'Other' },
];

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};

const fileName = (path: string) => path.split('/').pop() ?? path;

async function openInApp(r: Row) {
  await fetch(`${API_BASE}/files/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId: r.folderId, key: r.path, mimeType: r.mimeType }),
  });
}

async function openOnline(r: Row) {
  const res = await fetch(`${API_BASE}/files/open-online`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId: r.folderId, key: r.path }),
  });
  const data = await res.json();
  if (!res.ok) {
    window.alert(data.error ?? "Couldn't open online");
    return;
  }
  window.open(data.url);
}

async function downloadFile(r: Row) {
  const res = await fetch(`${API_BASE}/folders/${r.folderId}/download?key=${encodeURIComponent(r.path)}`);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(r.path);
  a.click();
  URL.revokeObjectURL(url);
}

export function FilesView({
  folders,
  filesByFolder,
  storage,
  loading,
  onRefresh,
  category,
  title,
  subtitle,
  clipboard,
  onClipboardChange,
}: {
  folders: FolderMeta[];
  filesByFolder: FilesByFolder;
  storage: ProviderStorage[];
  loading?: boolean;
  onRefresh: () => void;
  category?: BroadCategory;
  title?: string;
  subtitle?: string;
  clipboard: ClipboardEntry;
  onClipboardChange: (c: ClipboardEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [providerFilter, setProviderFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | BroadCategory>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'device' | 'cloud'>('all');
  const [deviceBackupFolders, setDeviceBackupFolders] = useState<Set<string>>(new Set());
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});
  const [openWithApps, setOpenWithApps] = useState<Record<string, { name: string; path: string }[]>>({});
  const [openWithPrefs, setOpenWithPrefs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const [activeRow, setActiveRow] = useState<Row | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ pos: { top: number; left: number }; row: Row } | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [bulkAction, setBulkAction] = useState<'move-cloud' | 'copy-pinned' | null>(null);
  const [nearbyTarget, setNearbyTarget] = useState<{ file: SendableFile; name: string } | null>(null);
  const devices = usePairedDevices();
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);

  useEffect(() => {
    if (!category) return;
    fetch(`${API_BASE}/accounts`)
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, string> = {};
        for (const a of data.accounts ?? []) map[a.accountId] = a.label;
        setAccountLabels(map);
      })
      .catch(() => {});
  }, [category]);

  useEffect(() => {
    fetch(`${API_BASE}/open-with`)
      .then((res) => res.json())
      .then((data) => {
        setOpenWithApps(data.apps ?? {});
        setOpenWithPrefs(data.prefs ?? {});
      })
      .catch(() => {});
  }, []);

  // which FolderConfig ids are a paired device's Sync Pair target — same "${providerId}:${remoteFolderId}"
  // matching CloudServicesView uses for its "Synced from Phone" tag, just resolved down to folder ids here
  // since Files rows already carry their own folderId.
  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then(async (data) => {
        const online: { id: string; name: string }[] = (data.paired ?? []).filter((d: { online: boolean }) => d.online);
        const remoteKeys = new Set<string>();
        await Promise.all(
          online.map(async (d) => {
            try {
              const res = await fetch(`${API_BASE}/devices/${d.id}/sync-pairs`);
              const pairData = await res.json();
              for (const p of pairData.pairs ?? []) {
                if (p.status !== 'active' || !p.remoteFolderId) continue;
                remoteKeys.add(`${p.providerId}:${p.remoteFolderId}`);
              }
            } catch {
              // that device just doesn't contribute any matches — not fatal to the rest of the filter
            }
          }),
        );
        const folderIds = new Set(
          folders.filter((f) => f.remoteFolderId && remoteKeys.has(`${f.provider}:${f.remoteFolderId}`)).map((f) => f.id),
        );
        setDeviceBackupFolders(folderIds);
      })
      .catch(() => {});
  }, [folders]);

  function providerLabelFor(id: string): string {
    return accountLabels[id] ?? PROVIDER_LABEL[baseProviderOf(id)] ?? id;
  }

  // "Open With Preview" / "Open With Google Chrome" etc — reflects whatever's actually set in
  // Settings → Default Apps, falling back to the first detected candidate for that file category.
  function openWithLabel(r: Row): string {
    const ext = r.path.split('.').pop()?.toLowerCase() ?? '';
    const category = { pdf: 'pdf', doc: 'docx', docx: 'docx', xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet', ppt: 'pptx', pptx: 'pptx', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image' }[ext];
    if (!category) return 'Open in App';
    const candidates = openWithApps[category] ?? [];
    const chosenPath = openWithPrefs[category];
    const app = candidates.find((a) => a.path === chosenPath) ?? candidates[0];
    return app ? `Open With ${app.name}` : 'Open in App';
  }

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const [folderId, files] of Object.entries(filesByFolder)) {
      const meta = folderMap.get(folderId);
      files.forEach((f, i) => {
        out.push({ ...f, uid: `${folderId}::${i}::${f.path}`, folderId, folderName: meta?.name ?? folderId, provider: meta?.provider ?? '?' });
      });
    }
    return category ? out.filter((r) => broadCategorize(r.path, r.mimeType) === category) : out;
  }, [folderMap, filesByFolder, category]);

  const providerOptions = useMemo(() => {
    const ids = Array.from(new Set(rows.map((r) => r.provider)));
    return ids.map((id) => ({ id, label: providerLabelFor(id) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, accountLabels]);

  const filtered = useMemo(() => {
    let list = rows.filter((r) => r.path.toLowerCase().includes(query.toLowerCase()));
    if (providerFilter !== 'all') list = list.filter((r) => r.provider === providerFilter);
    if (!category && typeFilter !== 'all') list = list.filter((r) => broadCategorize(r.path, r.mimeType) === typeFilter);
    if (sourceFilter === 'device') list = list.filter((r) => deviceBackupFolders.has(r.folderId));
    if (sourceFilter === 'cloud') list = list.filter((r) => !deviceBackupFolders.has(r.folderId));
    list = list.slice().sort((a, b) => {
      const av = sortKey === 'type' ? broadCategorize(a.path, a.mimeType) : a[sortKey as 'path' | 'size' | 'modifiedAt'];
      const bv = sortKey === 'type' ? broadCategorize(b.path, b.mimeType) : b[sortKey as 'path' | 'size' | 'modifiedAt'];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, query, sortKey, sortDir, category, providerFilter, typeFilter, sourceFilter, deviceBackupFolders]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (!activeRow) return;
      e.preventDefault();
      setPreviewRow((cur) => (cur ? null : activeRow));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeRow]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function toggleRow(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  function openPreview(r: Row) {
    setActiveRow(r);
    setPreviewRow(r);
  }

  // clicking a file launches whatever app is actually configured as default for it (Settings → Default
  // Apps) — the in-app quick-look modal is still one click away via the "Preview" menu item, but it's no
  // longer forced on every click regardless of what the user picked as their default.
  function handleOpen(r: Row) {
    setActiveRow(r);
    openInApp(r);
  }

  async function trashOne(r: Row): Promise<boolean> {
    const res = await fetch(`${API_BASE}/files/trash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: r.folderId, key: r.path }),
    });
    return res.ok;
  }

  async function trashRow(r: Row) {
    if (!window.confirm(`Move "${fileName(r.path)}" to Trash?`)) return;
    const ok = await trashOne(r);
    if (!ok) window.alert(`Couldn't delete "${fileName(r.path)}".`);
    onRefresh();
  }

  async function trashSelected() {
    if (!window.confirm(`Move ${selected.size} file(s) to Trash?`)) return;
    const targets = filtered.filter((r) => selected.has(r.uid));
    let failed = 0;
    setProgress({ label: 'Deleting', done: 0, total: targets.length });
    await runWithProgress(
      targets,
      async (r) => {
        if (!(await trashOne(r))) failed += 1;
      },
      (done, total) => setProgress({ label: 'Deleting', done, total }),
    );
    setProgress(null);
    if (failed > 0) window.alert(`${failed} of ${targets.length} file(s) couldn't be deleted.`);
    setSelected(new Set());
    onRefresh();
  }

  async function downloadSelected() {
    const targets = filtered.filter((r) => selected.has(r.uid));
    for (const r of targets) await downloadFile(r);
  }

  function bulkCopyOrCut(action: 'copy' | 'cut') {
    const targets = filtered.filter((r) => selected.has(r.uid));
    onClipboardChange({ kind: 'file', action, items: targets.map((r) => ({ folderId: r.folderId, path: r.path, name: fileName(r.path) })) });
    setSelected(new Set());
  }

  async function bulkMoveOrCopyToCloud(destProviderId: string, action: 'copy' | 'move') {
    const targets = filtered.filter((r) => selected.has(r.uid));
    let items: (Row & { destName: string })[] | null = targets.map((r) => ({ ...r, destName: fileName(r.path) }));
    if (action === 'copy') {
      const resolved = await resolveDestNames({ providerId: destProviderId }, targets.map((r) => ({ ...r, name: fileName(r.path) })));
      if (!resolved) return;
      items = resolved;
    }
    setBulkAction(null);
    setProgress({ label: action === 'copy' ? 'Copying' : 'Moving', done: 0, total: items.length });
    await runWithProgress(
      items,
      (r) =>
        fetch(`${API_BASE}/files/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceFolderId: r.folderId, key: r.path, destProviderId, destName: r.destName }),
        }).then(() => undefined),
      (done, total) => setProgress({ label: action === 'copy' ? 'Copying' : 'Moving', done, total }),
    );
    setProgress(null);
    setSelected(new Set());
    onRefresh();
  }

  async function bulkAddToPinnedFolder(destFolderId: string, action: 'copy' | 'move') {
    const targets = filtered.filter((r) => selected.has(r.uid));
    let items: (Row & { destName: string })[] | null = targets.map((r) => ({ ...r, destName: fileName(r.path) }));
    if (action === 'copy') {
      const resolved = await resolveDestNames({ folderId: destFolderId }, targets.map((r) => ({ ...r, name: fileName(r.path) })));
      if (!resolved) return;
      items = resolved;
    }
    setBulkAction(null);
    setProgress({ label: action === 'copy' ? 'Adding to folder' : 'Moving', done: 0, total: items.length });
    await runWithProgress(
      items,
      (r) =>
        fetch(`${API_BASE}/files/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceFolderId: r.folderId, key: r.path, destFolderId, destName: r.destName }),
        }).then(() => undefined),
      (done, total) => setProgress({ label: action === 'copy' ? 'Adding to folder' : 'Moving', done, total }),
    );
    setProgress(null);
    setSelected(new Set());
    onRefresh();
  }

  function toPreviewTarget(r: Row) {
    return { source: { kind: 'folder' as const, folderId: r.folderId }, key: r.path, name: fileName(r.path), size: r.size, provider: r.provider, folderName: r.folderName, modifiedAt: r.modifiedAt, hash: r.hash };
  }

  function menuItemsFor(r: Row): MenuItem[] {
    const readOnly = folderMap.get(r.folderId)?.remotePrefix === '*';
    const onlineItem: MenuItem[] = broadCategorize(r.path, r.mimeType) === 'document' ? [{ label: 'Open Online', onClick: () => openOnline(r) }] : [];
    const copyToClipboardItem: MenuItem = {
      label: 'Copy to Clipboard',
      onClick: () => copyFileToClipboard({ folderId: r.folderId, key: r.path, mimeType: r.mimeType }),
    };
    const sendFile: SendableFile = { kind: 'cloud', folderId: r.folderId, key: r.path, mimeType: r.mimeType };
    const sendItems = buildSendMenuItems(devices, sendFile, fileName(r.path), () => setNearbyTarget({ file: sendFile, name: fileName(r.path) }));
    if (readOnly) {
      return [
        { label: 'Preview', onClick: () => openPreview(r) },
        { label: openWithLabel(r), onClick: () => openInApp(r) },
        ...onlineItem,
        { label: 'Download', onClick: () => downloadFile(r) },
        copyToClipboardItem,
        { divider: true },
        ...sendItems,
        { divider: true },
        { label: 'Delete', danger: true, onClick: () => trashRow(r) },
        { label: 'Details', onClick: () => setPending({ kind: 'details', row: r }) },
      ];
    }
    return [
      { label: 'Preview', onClick: () => openPreview(r) },
      { label: openWithLabel(r), onClick: () => openInApp(r) },
      ...onlineItem,
      { label: 'Download', onClick: () => downloadFile(r) },
      copyToClipboardItem,
      { divider: true },
      ...sendItems,
      { divider: true },
      { label: 'Rename File', onClick: () => setPending({ kind: 'rename', row: r }) },
      { label: 'Copy', onClick: () => onClipboardChange({ kind: 'file', action: 'copy', items: [{ folderId: r.folderId, path: r.path, name: fileName(r.path) }] }) },
      { label: 'Cut', onClick: () => onClipboardChange({ kind: 'file', action: 'cut', items: [{ folderId: r.folderId, path: r.path, name: fileName(r.path) }] }) },
      { divider: true },
      { label: 'Delete', danger: true, onClick: () => trashRow(r) },
      { label: 'Details', onClick: () => setPending({ kind: 'details', row: r }) },
    ];
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>{title ?? 'Files'}</h1>
          <p>{subtitle ?? 'Everything synced across your connected clouds'}</p>
        </div>
      </div>

      {category && (
        <div className="toolbar-row">
          <select className="select-field" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="all">All Clouds</option>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select className="select-field" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="path">Sort: Name</option>
            <option value="size">Sort: Size</option>
            <option value="modifiedAt">Sort: Date Modified</option>
            <option value="type">Sort: File Type</option>
          </select>
          <button className="icon-btn" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} title="Reverse order">
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      )}

      {!category && (
        <div className="toolbar-row">
          <select className="select-field" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | BroadCategory)}>
            {TYPE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select className="select-field" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="all">All Clouds</option>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select className="select-field" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | 'device' | 'cloud')}>
            <option value="all">All Sources</option>
            <option value="device">Device Backups Only</option>
            <option value="cloud">Cloud Only (Hide Device Backups)</option>
          </select>
        </div>
      )}

      <div className="toolbar-row">
        <div className="search-field glass-card">
          <IconSearch size={14} />
          <input placeholder="Search files…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {clipboard?.kind === 'file' && (
          <button
            className="btn small primary"
            onClick={() => setPending({ kind: clipboard.action === 'cut' ? 'move' : 'copy', items: clipboard.items })}
          >
            {clipboard.items.length > 1 ? `Paste ${clipboard.items.length} Files Here` : 'Paste File Here'}
          </button>
        )}
        <button className={`icon-btn${layout === 'list' ? ' active' : ''}`} onClick={() => setLayout('list')} title="List view">
          <IconList size={16} />
        </button>
        <button className={`icon-btn${layout === 'grid' ? ' active' : ''}`} onClick={() => setLayout('grid')} title="Grid view">
          <IconGrid size={16} />
        </button>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar visible">
          <span>{selected.size} selected</span>
          <div className="spacer" />
          <button className="btn small" onClick={downloadSelected}>Download</button>
          <button className="btn small" onClick={() => bulkCopyOrCut('copy')}>Copy</button>
          <button className="btn small" onClick={() => bulkCopyOrCut('cut')}>Cut</button>
          <button className="btn small" onClick={() => setBulkAction('move-cloud')}>Move to Another Cloud</button>
          <button className="btn small" onClick={() => setBulkAction('copy-pinned')}>Add to Pinned Folder</button>
          <button className="btn small danger-outline" onClick={trashSelected}>Delete</button>
        </div>
      )}

      {loading && (
        <div className="table-wrap glass-card">
          <div className="table-scroll">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={`sk-${i}`} className="skeleton-row" style={{ borderBottom: '1px solid var(--hairline)' }}>
                <Skeleton width={16} height={16} radius={4} />
                <Skeleton width={`${40 + (i % 3) * 10}%`} height={12} />
                <Skeleton width={70} height={10} style={{ marginLeft: 'auto' }} />
                <Skeleton width={50} height={10} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && filtered.length === 0 && <div className="empty-state glass-card">No files match "{query}"</div>}

      {!loading && filtered.length > 0 && layout === 'list' && (
        <div className="table-wrap glass-card">
          <div className="table-scroll">
            <table className="files">
              <thead>
                <tr>
                  <th className="check">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(filtered.map((r) => r.uid)) : new Set())
                      }
                    />
                  </th>
                  <th className="sortable" onClick={() => toggleSort('path')}>Name {sortKey === 'path' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  <th>Folder</th>
                  <th>Provider</th>
                  <th className="sortable" onClick={() => toggleSort('size')}>Size {sortKey === 'size' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  <th className="sortable" onClick={() => toggleSort('modifiedAt')}>Modified {sortKey === 'modifiedAt' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.uid}
                    className={activeRow === r ? 'row-active' : ''}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName === 'INPUT') return;
                      handleOpen(r);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setActiveRow(r);
                      setCtxMenu({ pos: { top: e.clientY, left: e.clientX }, row: r });
                    }}
                  >
                    <td className="check">
                      <input type="checkbox" checked={selected.has(r.uid)} onChange={() => toggleRow(r.uid)} />
                    </td>
                    <td className="name">
                      <span className={`file-type-glyph type-${categorize(r.path) === 'other' ? 'other' : categorize(r.path)}`} />
                      {fileName(r.path)}
                    </td>
                    <td>{r.folderName}</td>
                    <td><span className="provider-chip">{r.provider}</span></td>
                    <td className="size">{formatBytes(r.size)}</td>
                    <td className="time">{new Date(r.modifiedAt).toLocaleString()}</td>
                    <td>
                      <DropdownMenu items={menuItemsFor(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && layout === 'grid' && (
        <div className="folder-grid">
          {filtered.map((r) => (
            <div
              key={r.uid}
              className="folder-card glass-card"
              style={{ position: 'relative' }}
              onClick={() => handleOpen(r)}
              onContextMenu={(e) => {
                e.preventDefault();
                setActiveRow(r);
                setCtxMenu({ pos: { top: e.clientY, left: e.clientX }, row: r });
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(r.uid)}
                onChange={() => toggleRow(r.uid)}
                onClick={(e) => e.stopPropagation()}
                style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, cursor: 'pointer' }}
              />
              <DropdownMenu items={menuItemsFor(r)} />
              <Thumbnail folderId={r.folderId} fileKey={r.path} name={fileName(r.path)} size={r.size} thumbnailUrl={r.thumbnailUrl} />
              <div className="folder-name">{fileName(r.path)}</div>
              <div className="folder-meta">{r.provider}</div>
            </div>
          ))}
        </div>
      )}

      <ContextMenu
        pos={ctxMenu?.pos ?? null}
        items={ctxMenu ? menuItemsFor(ctxMenu.row) : []}
        onClose={() => setCtxMenu(null)}
      />

      {previewRow && (
        <PreviewModal file={toPreviewTarget(previewRow)} apiBase={API_BASE} onClose={() => setPreviewRow(null)} />
      )}

      {pending?.kind === 'rename' && (
        <RenameModal
          currentName={fileName(pending.row.path)}
          onClose={() => setPending(null)}
          onConfirm={async (newName) => {
            await fetch(`${API_BASE}/files/rename`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folderId: pending.row.folderId, key: pending.row.path, newName }),
            });
            setPending(null);
            onRefresh();
          }}
        />
      )}

      {(pending?.kind === 'copy' || pending?.kind === 'move') && (
        <DestinationPickerModal
          title={pending.kind === 'copy' ? 'Paste — Copy to' : 'Paste — Move to'}
          confirmLabel={pending.kind === 'copy' ? 'Paste (Copy)' : 'Paste (Move)'}
          folders={folders}
          storage={storage}
          excludeFolderId={pending.items[0]?.folderId ?? ''}
          onClose={() => setPending(null)}
          onConfirm={async (destFolderId) => {
            // a clipboard item staged from a paired device's file browser (RemoteBrowser's Copy/Cut) has no
            // registered sourceFolderId to move/copy between — it needs to go through the device-copy
            // backend route instead, which downloads from the phone and uploads into the chosen cloud folder.
            if (pending.items[0]?.deviceId) {
              const destFolder = folders.find((f) => f.id === destFolderId);
              if (!destFolder) return;
              setPending(null);
              setProgress({ label: pending.kind === 'copy' ? 'Pasting' : 'Moving', done: 0, total: pending.items.length });
              await runWithProgress(
                pending.items,
                (item) => pasteClipboardItem(item, { folderId: destFolder.id, provider: destFolder.provider }, pending.kind === 'copy' ? 'copy' : 'cut'),
                (done, total) => setProgress({ label: pending.kind === 'copy' ? 'Pasting' : 'Moving', done, total }),
              );
              setProgress(null);
              if (pending.kind === 'move') onClipboardChange(null);
              onRefresh();
              return;
            }

            const endpoint = pending.kind === 'copy' ? 'copy' : 'move';
            let items = pending.items.map((it) => ({ ...it, destName: it.name }));
            if (pending.kind === 'copy') {
              const resolved = await resolveDestNames({ folderId: destFolderId }, pending.items);
              if (!resolved) return;
              items = resolved;
            }
            setPending(null);
            setProgress({ label: pending.kind === 'copy' ? 'Pasting' : 'Moving', done: 0, total: items.length });
            await runWithProgress(
              items,
              (item) =>
                fetch(`${API_BASE}/files/${endpoint}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sourceFolderId: item.folderId, key: item.path, destFolderId, destName: item.destName }),
                }).then(() => undefined),
              (done, total) => setProgress({ label: pending.kind === 'copy' ? 'Pasting' : 'Moving', done, total }),
            );
            setProgress(null);
            // a cut is a one-shot move — the clipboard is spent once pasted; a copy stays for repeat pastes.
            if (pending.kind === 'move') onClipboardChange(null);
            onRefresh();
          }}
        />
      )}

      {pending?.kind === 'details' && (
        <FileDetailsModal
          folderId={pending.row.folderId}
          fileKey={pending.row.path}
          onClose={() => setPending(null)}
        />
      )}

      {bulkAction === 'move-cloud' && (
        <ProviderPickerModal
          title={`Move ${selected.size} file(s) to another cloud`}
          confirmLabel="Move"
          storage={storage}
          excludeProviderId=""
          onClose={() => setBulkAction(null)}
          onConfirm={(destProviderId) => bulkMoveOrCopyToCloud(destProviderId, 'move')}
        />
      )}

      {bulkAction === 'copy-pinned' && (
        <DestinationPickerModal
          title={`Add ${selected.size} file(s) to a pinned folder`}
          confirmLabel="Add"
          folders={folders}
          storage={storage}
          excludeFolderId=""
          onClose={() => setBulkAction(null)}
          onConfirm={(destFolderId) => bulkAddToPinnedFolder(destFolderId, 'copy')}
        />
      )}

      {progress && <ProgressModal label={progress.label} done={progress.done} total={progress.total} />}

      {nearbyTarget && (
        <NearbyPickerModal file={nearbyTarget.file} fileName={nearbyTarget.name} onClose={() => setNearbyTarget(null)} />
      )}
    </section>
  );
}
