import React, { useEffect, useState } from 'react';
import type { FileEntry, FolderNode, ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import type { FolderMeta, ClipboardEntry, ClipboardFileItem, SyncPair } from '../lib/types';
import { formatBytes, broadCategorize } from '../lib/format';
import { IconChevronLeft, IconSearch, IconCloud, IconAdd, IconFolder, IconSync } from '../icons';
import { Thumbnail } from '../components/Thumbnail';
import { DropdownMenu } from '../components/DropdownMenu';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { PreviewModal, PreviewTarget } from '../components/PreviewModal';
import { Skeleton } from '../components/Skeleton';
import { RenameModal } from '../components/RenameModal';
import { FileDetailsModal } from '../components/FileDetailsModal';
import { DestinationPickerModal } from '../components/DestinationPickerModal';
import { ProviderPickerModal } from '../components/ProviderPickerModal';
import { ProgressModal } from '../components/ProgressModal';
import { runWithProgress } from '../lib/batch';
import { resolveDestNames } from '../lib/duplicateCheck';
import { copyFileToClipboard } from '../lib/copyToClipboard';
import { pasteClipboardItem } from '../lib/pasteFile';
import { usePairedDevices, buildSendMenuItems, SendableFile } from '../lib/sendActions';
import { NearbyPickerModal } from '../components/NearbyPickerModal';

const API_BASE = 'http://localhost:4310';

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};

type PendingAction =
  | { kind: 'rename'; path: string }
  | { kind: 'details'; path: string }
  | { kind: 'move-cloud'; paths: string[] }
  | { kind: 'move-pinned' | 'copy-pinned'; paths: string[] }
  | null;

export function CloudServicesView({
  connected,
  loading: appLoading,
  folders,
  storage,
  clipboard,
  onClipboardChange,
  onOpenPinnedFolder,
  onOpenSync,
}: {
  connected: string[];
  loading?: boolean;
  folders: FolderMeta[];
  storage: ProviderStorage[];
  clipboard: ClipboardEntry;
  onClipboardChange: (c: ClipboardEntry) => void;
  onOpenPinnedFolder: (id: string) => void;
  onOpenSync: () => void;
}) {
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [subFolders, setSubFolders] = useState<FolderNode[]>([]);
  const [folderPath, setFolderPath] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Top Level' }]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [nearbyTarget, setNearbyTarget] = useState<{ file: SendableFile; name: string } | null>(null);
  const devices = usePairedDevices();
  const [syncPairs, setSyncPairs] = useState<SyncPair[]>([]);
  // "providerId:realFolderId" -> the phone's name — a phone's own Sync Pairs live entirely on the phone
  // (SharedPreferences, not this app's own syncPairs.ts registry), so a real folder it's pushing into has
  // no equivalent of the Mac-originated syncPairsForProvider tag below unless fetched separately.
  const [phoneSyncFolders, setPhoneSyncFolders] = useState<Record<string, string>>({});

  const currentFolderId = folderPath[folderPath.length - 1].id;

  // Sync Pairs (Sync Engine folders synced in from this Mac) — a small, account-independent list, so one
  // fetch on mount covers every provider tab rather than re-fetching per account switch.
  useEffect(() => {
    fetch(`${API_BASE}/sync/pairs`)
      .then((res) => res.json())
      .then((data) => setSyncPairs(data.pairs ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then(async (data) => {
        const online: { id: string; name: string; platform: string }[] = (data.paired ?? []).filter((d: { online: boolean }) => d.online);
        const map: Record<string, string> = {};
        await Promise.all(
          online.map(async (d) => {
            try {
              const res = await fetch(`${API_BASE}/devices/${d.id}/sync-pairs`);
              const pairData = await res.json();
              for (const p of pairData.pairs ?? []) {
                if (p.status !== 'active' || !p.remoteFolderId) continue;
                map[`${p.providerId}:${p.remoteFolderId}`] = d.name;
              }
            } catch {
              // that device just doesn't show any tags — not fatal to the rest of the browser
            }
          }),
        );
        setPhoneSyncFolders(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/accounts`)
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, string> = {};
        for (const a of data.accounts ?? []) map[a.accountId] = a.label;
        setAccountLabels(map);
      })
      .catch(() => {});
  }, []);

  // browses the account's REAL folder tree one level at a time (same /providers/:id/tree route the
  // Upload picker already uses) — this used to hit /providers/:id/browse, a flat listing that showed
  // every file in the account with no folders at all, so a folder the user created (and anything filed
  // into it) was invisible here even though it existed and worked fine everywhere else.
  useEffect(() => {
    if (!openProvider) return;
    setLoading(true);
    setError(null);
    const qs = currentFolderId ? `?folderId=${encodeURIComponent(currentFolderId)}` : '';
    fetch(`${API_BASE}/providers/${openProvider}/tree${qs}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFiles(data.files ?? []);
        setSubFolders(data.folders ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [openProvider, currentFolderId, refreshTick]);

  function refresh() {
    setRefreshTick((t) => t + 1);
  }

  function enterFolder(folder: FolderNode) {
    setFolderPath((p) => [...p, { id: folder.id, name: folder.name }]);
    setSelected(new Set());
  }

  function jumpToBreadcrumb(index: number) {
    setFolderPath((p) => p.slice(0, index + 1));
    setSelected(new Set());
  }

  async function createFolder() {
    if (!openProvider || !newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await fetch(`${API_BASE}/providers/${openProvider}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: currentFolderId, name: newFolderName.trim() }),
      });
      if (res.ok) {
        setNewFolderName('');
        setNewFolderOpen(false);
        refresh();
      }
    } finally {
      setCreatingFolder(false);
    }
  }

  function labelFor(id: string): string {
    return accountLabels[id] ?? PROVIDER_LABEL[baseProviderOf(id)] ?? id;
  }
  const fileName = (path: string) => path.split('/').pop() ?? path;
  const filtered = files.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()));
  const pinnedForProvider = currentFolderId === null ? folders.filter((f) => f.provider === openProvider && f.pinned !== false) : [];
  const syncPairsForProvider = currentFolderId === null ? syncPairs.filter((p) => p.targetKind === 'cloud' && p.providerId === openProvider) : [];

  async function downloadFile(f: FileEntry) {
    const res = await fetch(`${API_BASE}/providers/${openProvider}/download?key=${encodeURIComponent(f.path)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(f.path);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openInApp(f: FileEntry) {
    await fetch(`${API_BASE}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: openProvider, key: f.path, mimeType: f.mimeType }),
    });
  }

  async function openOnline(f: FileEntry) {
    const res = await fetch(`${API_BASE}/files/open-online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: openProvider, key: f.path }),
    });
    const data = await res.json();
    if (!res.ok) {
      window.alert(data.error ?? "Couldn't open online");
      return;
    }
    window.open(data.url);
  }

  async function trashFile(f: FileEntry) {
    if (!window.confirm(`Move "${fileName(f.path)}" to Trash?`)) return;
    await fetch(`${API_BASE}/files/trash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: openProvider, key: f.path }),
    });
    refresh();
  }

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  async function bulkDelete() {
    if (!window.confirm(`Move ${selected.size} file(s) to Trash?`)) return;
    const targets = Array.from(selected);
    setProgress({ label: 'Deleting', done: 0, total: targets.length });
    await runWithProgress(
      targets,
      (p) =>
        fetch(`${API_BASE}/files/trash`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: openProvider, key: p }),
        }).then(() => undefined),
      (done, total) => setProgress({ label: 'Deleting', done, total }),
    );
    setProgress(null);
    setSelected(new Set());
    refresh();
  }

  function menuItemsFor(f: FileEntry) {
    const canOpenOnline = broadCategorize(f.path, f.mimeType) === 'document';
    const sendFile: SendableFile = { kind: 'cloud', providerId: openProvider!, key: f.path, mimeType: f.mimeType };
    const sendItems = buildSendMenuItems(devices, sendFile, fileName(f.path), () => setNearbyTarget({ file: sendFile, name: fileName(f.path) }));
    return [
      {
        label: 'Preview',
        onClick: () =>
          setPreview({
            source: { kind: 'provider', providerId: openProvider! },
            key: f.path,
            name: fileName(f.path),
            size: f.size,
            provider: openProvider!,
            folderName: labelFor(openProvider!),
            modifiedAt: f.modifiedAt,
            hash: f.hash,
          }),
      },
      { label: 'Open In App', onClick: () => openInApp(f) },
      ...(canOpenOnline ? [{ label: 'Open Online', onClick: () => openOnline(f) }] : []),
      { label: 'Download', onClick: () => downloadFile(f) },
      { label: 'Copy to Clipboard', onClick: () => copyFileToClipboard({ providerId: openProvider!, key: f.path, mimeType: f.mimeType }) },
      { divider: true },
      ...sendItems,
      { divider: true },
      { label: 'Rename', onClick: () => setPending({ kind: 'rename', path: f.path }) },
      { label: 'Copy', onClick: () => onClipboardChange({ kind: 'file', action: 'copy', items: [{ folderId: `provider:${openProvider}`, path: f.path, name: fileName(f.path) }] }) },
      { label: 'Cut', onClick: () => onClipboardChange({ kind: 'file', action: 'cut', items: [{ folderId: `provider:${openProvider}`, path: f.path, name: fileName(f.path) }] }) },
      { label: 'Move to Another Cloud', onClick: () => setPending({ kind: 'move-cloud', paths: [f.path] }) },
      { label: 'Move to Pinned Folder', onClick: () => setPending({ kind: 'move-pinned', paths: [f.path] }) },
      { divider: true },
      { label: 'Delete', danger: true, onClick: () => trashFile(f) },
      { label: 'Details', onClick: () => setPending({ kind: 'details', path: f.path }) },
    ];
  }

  // the plain clipboard entry stores a folderId per item — for a raw provider browse we tag it
  // "provider:<id>" and unpack it back out here (Paste, when it shows up in a real folder context, only
  // ever deals with a genuine folderId, so this tagging never leaks anywhere else).
  function unpackClipboardItem(item: ClipboardFileItem) {
    if (item.folderId.startsWith('provider:')) return { sourceProviderId: item.folderId.slice('provider:'.length) };
    return { sourceFolderId: item.folderId };
  }

  async function pasteHere() {
    if (clipboard?.kind !== 'file' || !openProvider) return;

    if (clipboard.items[0]?.deviceId) {
      const label = clipboard.action === 'copy' ? 'Pasting' : 'Moving';
      setProgress({ label, done: 0, total: clipboard.items.length });
      await runWithProgress(
        clipboard.items,
        (item) => pasteClipboardItem(item, { provider: openProvider }, clipboard.action),
        (done, total) => setProgress({ label, done, total }),
      );
      setProgress(null);
      if (clipboard.action === 'cut') onClipboardChange(null);
      refresh();
      return;
    }

    const endpoint = clipboard.action === 'copy' ? 'copy' : 'move';
    let items = clipboard.items.map((it) => ({ ...it, destName: it.name }));
    if (clipboard.action === 'copy') {
      const resolved = await resolveDestNames({ providerId: openProvider }, clipboard.items);
      if (!resolved) return;
      items = resolved;
    }
    setProgress({ label: clipboard.action === 'copy' ? 'Pasting' : 'Moving', done: 0, total: items.length });
    await runWithProgress(
      items,
      (item) =>
        fetch(`${API_BASE}/files/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...unpackClipboardItem(item), key: item.path, destProviderId: openProvider, destName: item.destName }),
        }).then(() => undefined),
      (done, total) => setProgress({ label: clipboard.action === 'copy' ? 'Pasting' : 'Moving', done, total }),
    );
    setProgress(null);
    if (clipboard.action === 'cut') onClipboardChange(null);
    refresh();
  }

  function bulkCopyOrCut(action: 'copy' | 'cut') {
    const items: ClipboardFileItem[] = Array.from(selected).map((p) => ({ folderId: `provider:${openProvider}`, path: p, name: fileName(p) }));
    onClipboardChange({ kind: 'file', action, items });
    setSelected(new Set());
  }

  if (!openProvider) {
    return (
      <section className="view active">
        <div className="view-header">
          <div>
            <h1>Cloud Services</h1>
            <p>Browse everything in each connected cloud account</p>
          </div>
        </div>

        {!appLoading && connected.length === 0 && (
          <div className="glass-card empty-state">
            <IconCloud size={26} />
            <div style={{ marginTop: 10 }}>No clouds connected yet — connect one from Settings.</div>
          </div>
        )}

        <div className="folder-grid">
          {appLoading && connected.length === 0 && [0, 1, 2].map((i) => (
            <div className="folder-card glass-card skeleton-folder-card" key={`sk-${i}`}>
              <Skeleton width={30} height={30} radius={8} />
              <Skeleton width="70%" height={12} />
              <Skeleton width="45%" height={10} />
            </div>
          ))}
          {!appLoading && connected.map((id) => (
            <div key={id} className="folder-card glass-card" onClick={() => { setOpenProvider(id); setFolderPath([{ id: null, name: labelFor(id) }]); }}>
              <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={CLOUD_ICONS[baseProviderOf(id)]} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
              </div>
              <div className="folder-name">{labelFor(id)}</div>
              <div className="folder-meta">Browse full account</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <button
            className="btn small"
            onClick={() => { setOpenProvider(null); setFiles([]); setSubFolders([]); setFolderPath([{ id: null, name: 'Top Level' }]); setQuery(''); setSelected(new Set()); }}
            style={{ marginBottom: 10 }}
          >
            <IconChevronLeft size={12} /> Back
          </button>
          <h1>{labelFor(openProvider)}</h1>
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {folderPath.map((crumb, i) => (
              <React.Fragment key={crumb.id ?? 'root'}>
                {i > 0 && <span style={{ opacity: 0.5 }}>/</span>}
                <span
                  onClick={() => jumpToBreadcrumb(i)}
                  style={{ cursor: i < folderPath.length - 1 ? 'pointer' : 'default', textDecoration: i < folderPath.length - 1 ? 'underline' : 'none' }}
                >
                  {crumb.name}
                </span>
              </React.Fragment>
            ))}
            <span style={{ opacity: 0.6 }}>
              · {files.length} file{files.length === 1 ? '' : 's'}, {subFolders.length + pinnedForProvider.length} folder{subFolders.length + pinnedForProvider.length === 1 ? '' : 's'}
            </span>
          </p>
        </div>
        {clipboard?.kind === 'file' && (
          <button className="btn primary" onClick={pasteHere}>
            {clipboard.items.length > 1 ? `Paste ${clipboard.items.length} Files Here` : 'Paste File Here'}
          </button>
        )}
      </div>

      <div className="toolbar-row">
        <div className="search-field glass-card">
          <IconSearch size={14} />
          <input placeholder="Search files…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {!newFolderOpen && (
          <button className="btn small" onClick={() => setNewFolderOpen(true)}>
            <IconAdd size={12} /> Create Folder
          </button>
        )}
        {newFolderOpen && (
          <>
            <input
              autoFocus
              className="select-field"
              placeholder="Folder name…"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder();
                if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName(''); }
              }}
              style={{ maxWidth: 200 }}
            />
            <button className="btn small primary" disabled={creatingFolder || !newFolderName.trim()} onClick={createFolder}>
              {creatingFolder ? 'Creating…' : 'Create'}
            </button>
            <button className="btn small" onClick={() => { setNewFolderOpen(false); setNewFolderName(''); }}>Cancel</button>
          </>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar visible">
          <span>{selected.size} selected</span>
          <div className="spacer" />
          <button className="btn small" onClick={() => bulkCopyOrCut('copy')}>Copy</button>
          <button className="btn small" onClick={() => bulkCopyOrCut('cut')}>Cut</button>
          <button className="btn small" onClick={() => setPending({ kind: 'move-cloud', paths: Array.from(selected) })}>Move to Another Cloud</button>
          <button className="btn small" onClick={() => setPending({ kind: 'copy-pinned', paths: Array.from(selected) })}>Add to Pinned Folder</button>
          <button className="btn small danger-outline" onClick={bulkDelete}>Delete</button>
        </div>
      )}

      {loading && <div className="glass-card empty-state">Loading…</div>}
      {error && <div className="glass-card empty-state" style={{ color: 'var(--offline)' }}>{error}</div>}

      {!loading && !error && (
        <div className="folder-grid">
          {/* Pinned Folders — AllieMinate's own registered folders (created from the Pinned Folders page)
              — live in a completely separate system from the account's real native folder tree below (a
              pinned folder has no corresponding real cloud folder; its files are stored under a flat key
              prefix). Only shown at the account's top level, since pinned folders don't nest. Clicking one
              jumps to the Pinned Folders page, which already has full browsing for it — no need to
              duplicate that here. */}
          {pinnedForProvider
            .filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
            .map((pf) => (
                <div key={pf.id} className="folder-card glass-card" onClick={() => onOpenPinnedFolder(pf.id)}>
                  <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconFolder size={28} />
                  </div>
                  <div className="folder-name">{pf.name}</div>
                  <div className="folder-meta">Pinned Folder</div>
                </div>
              ))}
          {/* Sync Pairs (Sync Engine) — same flat-key-prefix storage model as a pinned folder, files land
              directly in this account's managed space rather than a real provider folder object; shown
              here for the same reason pinned folders are, and clicking jumps to the Sync page where the
              full pause/resume/progress controls already live. */}
          {syncPairsForProvider
            .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
            .map((p) => (
              <div key={p.id} className="folder-card glass-card" onClick={onOpenSync}>
                <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconSync size={28} />
                </div>
                <div className="folder-name">{p.name}</div>
                <div className="folder-meta">Synced from Mac</div>
              </div>
            ))}
          {subFolders
            .filter((sf) => sf.name.toLowerCase().includes(query.toLowerCase()))
            .map((sf) => {
              const syncedFromPhone = phoneSyncFolders[`${openProvider}:${sf.id}`];
              return (
                <div key={sf.id} className="folder-card glass-card" onClick={() => enterFolder(sf)}>
                  <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {syncedFromPhone ? <IconSync size={28} /> : <IconFolder size={28} />}
                  </div>
                  <div className="folder-name">{sf.name}</div>
                  <div className="folder-meta">{syncedFromPhone ? `Synced from ${syncedFromPhone}` : 'Folder'}</div>
                </div>
              );
            })}
          {filtered.map((f) => (
            <div
              key={f.path}
              className="folder-card glass-card"
              onClick={() => openInApp(f)}
            >
              <input
                type="checkbox"
                checked={selected.has(f.path)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelect(f.path)}
                style={{ position: 'absolute', top: 4, left: 4, zIndex: 2 }}
              />
              <DropdownMenu items={menuItemsFor(f)} />
              <Thumbnail providerId={openProvider} fileKey={f.path} name={fileName(f.path)} size={f.size} thumbnailUrl={f.thumbnailUrl} />
              <div className="folder-name">{fileName(f.path)}</div>
              <div className="folder-meta">{formatBytes(f.size)}</div>
            </div>
          ))}
          {filtered.length === 0 && query && (subFolders.length > 0 || pinnedForProvider.length > 0) && (
            <div className="empty-state">{`No files match "${query}"`}</div>
          )}
          {filtered.length === 0 && subFolders.length === 0 && pinnedForProvider.length === 0 && (
            <div className="empty-state">{query ? `No files match "${query}"` : 'No Files in This Cloud'}</div>
          )}
        </div>
      )}

      {preview && <PreviewModal file={preview} apiBase={API_BASE} onClose={() => setPreview(null)} />}

      {pending?.kind === 'rename' && (
        <RenameModal
          currentName={fileName(pending.path)}
          onClose={() => setPending(null)}
          onConfirm={async (newName) => {
            await fetch(`${API_BASE}/files/rename`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ providerId: openProvider, key: pending.path, newName }),
            });
            setPending(null);
            refresh();
          }}
        />
      )}

      {pending?.kind === 'details' && (
        <FileDetailsModal providerId={openProvider} fileKey={pending.path} onClose={() => setPending(null)} />
      )}

      {pending?.kind === 'move-cloud' && (
        <ProviderPickerModal
          title="Move to another cloud"
          confirmLabel="Move"
          storage={storage}
          excludeProviderId={openProvider}
          onClose={() => setPending(null)}
          onConfirm={async (destProviderId) => {
            setPending(null);
            setProgress({ label: 'Moving', done: 0, total: pending.paths.length });
            await runWithProgress(
              pending.paths,
              (p) =>
                fetch(`${API_BASE}/files/move`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sourceProviderId: openProvider, key: p, destProviderId }),
                }).then(() => undefined),
              (done, total) => setProgress({ label: 'Moving', done, total }),
            );
            setProgress(null);
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      {(pending?.kind === 'move-pinned' || pending?.kind === 'copy-pinned') && (
        <DestinationPickerModal
          title={pending.kind === 'copy-pinned' ? 'Add to pinned folder' : 'Move to pinned folder'}
          confirmLabel={pending.kind === 'copy-pinned' ? 'Add' : 'Move'}
          folders={folders}
          storage={storage}
          excludeFolderId=""
          onClose={() => setPending(null)}
          onConfirm={async (destFolderId) => {
            const endpoint = pending.kind === 'copy-pinned' ? 'copy' : 'move';
            let items = pending.paths.map((p) => ({ path: p, name: fileName(p), destName: fileName(p) }));
            if (pending.kind === 'copy-pinned') {
              const resolved = await resolveDestNames({ folderId: destFolderId }, pending.paths.map((p) => ({ path: p, name: fileName(p) })));
              if (!resolved) return;
              items = resolved;
            }
            setPending(null);
            const label = pending.kind === 'copy-pinned' ? 'Adding to folder' : 'Moving';
            setProgress({ label, done: 0, total: items.length });
            await runWithProgress(
              items,
              (item) =>
                fetch(`${API_BASE}/files/${endpoint}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sourceProviderId: openProvider, key: item.path, destFolderId, destName: item.destName }),
                }).then(() => undefined),
              (done, total) => setProgress({ label, done, total }),
            );
            setProgress(null);
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      {progress && <ProgressModal label={progress.label} done={progress.done} total={progress.total} />}

      {nearbyTarget && (
        <NearbyPickerModal file={nearbyTarget.file} fileName={nearbyTarget.name} onClose={() => setNearbyTarget(null)} />
      )}
    </section>
  );
}
