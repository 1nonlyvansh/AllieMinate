import React, { useEffect, useMemo, useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import type { FolderMeta, FilesByFolder, ClipboardEntry, ClipboardFileItem } from '../lib/types';
import { formatBytes, broadCategorize } from '../lib/format';
import { IconFolder, IconAdd, IconChevronLeft, IconUpload } from '../icons';
import { Thumbnail } from '../components/Thumbnail';
import { PreviewModal, PreviewTarget } from '../components/PreviewModal';
import { Skeleton } from '../components/Skeleton';
import { FolderCardMenu } from '../components/FolderCardMenu';
import { AddFolderModal } from '../components/AddFolderModal';
import { UploadModal } from '../components/UploadModal';
import { DropdownMenu } from '../components/DropdownMenu';
import { RenameModal } from '../components/RenameModal';
import { FileDetailsModal } from '../components/FileDetailsModal';
import { ProgressModal } from '../components/ProgressModal';
import { ProviderPickerModal } from '../components/ProviderPickerModal';
import { DestinationPickerModal } from '../components/DestinationPickerModal';
import { MarqueeRect } from '../components/MarqueeRect';
import { useMarqueeSelect } from '../lib/useMarqueeSelect';
import { runWithProgress } from '../lib/batch';
import { resolveDestNames } from '../lib/duplicateCheck';
import { copyFileToClipboard } from '../lib/copyToClipboard';
import { pasteClipboardItem } from '../lib/pasteFile';
import { usePairedDevices, buildSendMenuItems, SendableFile } from '../lib/sendActions';
import { NearbyPickerModal } from '../components/NearbyPickerModal';

const TAG_COLORS = ['#3a5fe0', '#16a34a', '#f0a63a', '#c026d3', '#0891b2'];
const API_BASE = 'http://localhost:4310';

export function PinnedFoldersView({
  folders,
  filesByFolder,
  storage,
  openRequest,
  loading,
  onRefresh,
  clipboard,
  onClipboardChange,
}: {
  folders: FolderMeta[];
  filesByFolder: FilesByFolder;
  storage: ProviderStorage[];
  openRequest?: { folderId: string; nonce: number } | null;
  loading?: boolean;
  onRefresh: () => void;
  clipboard: ClipboardEntry;
  onClipboardChange: (c: ClipboardEntry) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAnchor, setSelectAnchor] = useState<string | null>(null);
  const marqueeSelect = useMarqueeSelect(() => selected, setSelected);
  const [bulkAction, setBulkAction] = useState<'move-cloud' | 'copy-pinned' | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [nearbyTarget, setNearbyTarget] = useState<{ file: SendableFile; name: string } | null>(null);
  const devices = usePairedDevices();
  const open = folders.find((f) => f.id === openId);

  useEffect(() => {
    if (openRequest) setOpenId(openRequest.folderId);
  }, [openRequest]);

  useEffect(() => {
    setSelected(new Set());
    setSelectAnchor(null);
  }, [openId]);

  // hooks-safe mirror of the `files` list built inside the `if (open)` render branch below — a plain
  // `const` there can't be reached by this effect, which needs to run every render regardless of whether
  // a folder happens to be open.
  const openFiles = useMemo(
    () => (openId ? (filesByFolder[openId] ?? []).map((f, i) => ({ ...f, uid: `${openId}::${i}::${f.path}` })) : []),
    [openId, filesByFolder],
  );

  // Spacebar previews the single selected file — image/video only, matching what PreviewModal actually
  // renders inline now (everything else opens straight in its app).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (selected.size !== 1 || !open) return;
      const f = openFiles.find((r) => selected.has(r.uid));
      if (!f) return;
      const cat = broadCategorize(f.path, f.mimeType);
      if (cat !== 'image' && cat !== 'video') return;
      e.preventDefault();
      const name = f.path.split('/').pop() ?? f.path;
      setPreview((cur) =>
        cur
          ? null
          : { source: { kind: 'folder', folderId: open.id }, key: f.path, name, size: f.size, provider: open.provider, folderName: open.name, modifiedAt: f.modifiedAt, hash: f.hash },
      );
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, openFiles, open]);

  async function openInApp(folderId: string, key: string, mimeType?: string) {
    await fetch(`${API_BASE}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, key, mimeType }),
    });
  }

  async function trashFile(folderId: string, key: string) {
    if (!window.confirm(`Move "${key.split('/').pop()}" to Trash?`)) return;
    await fetch(`${API_BASE}/files/trash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, key }),
    });
    onRefresh();
  }

  async function downloadFile(folderId: string, key: string) {
    const res = await fetch(`${API_BASE}/folders/${folderId}/download?key=${encodeURIComponent(key)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = key.split('/').pop() ?? key;
    a.click();
    URL.revokeObjectURL(url);
  }

  // pastes a file straight into the currently-open folder — no destination picker needed, we already
  // know exactly where we are.
  async function pasteFileHere(folderId: string) {
    if (clipboard?.kind !== 'file') return;

    if (clipboard.items[0]?.deviceId) {
      const destFolder = folders.find((f) => f.id === folderId);
      if (!destFolder) return;
      const label = clipboard.action === 'copy' ? 'Pasting' : 'Moving';
      setProgress({ label, done: 0, total: clipboard.items.length });
      await runWithProgress(
        clipboard.items,
        (item) => pasteClipboardItem(item, { folderId: destFolder.id, provider: destFolder.provider }, clipboard.action),
        (done, total) => setProgress({ label, done, total }),
      );
      setProgress(null);
      if (clipboard.action === 'cut') onClipboardChange(null);
      onRefresh();
      return;
    }

    const endpoint = clipboard.action === 'copy' ? 'copy' : 'move';
    let items = clipboard.items.map((it) => ({ ...it, destName: it.name }));
    if (clipboard.action === 'copy') {
      const resolved = await resolveDestNames({ folderId }, clipboard.items);
      if (!resolved) return;
      items = resolved;
    }
    const label = clipboard.action === 'copy' ? 'Pasting' : 'Moving';
    setProgress({ label, done: 0, total: items.length });
    await runWithProgress(
      items,
      (item) =>
        fetch(`${API_BASE}/files/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceFolderId: item.folderId, key: item.path, destFolderId: folderId, destName: item.destName }),
        }).then(() => undefined),
      (done, total) => setProgress({ label, done, total }),
    );
    setProgress(null);
    if (clipboard.action === 'cut') onClipboardChange(null);
    onRefresh();
  }

  async function pasteFolder() {
    if (clipboard?.kind !== 'folder') return;
    if (clipboard.action === 'copy') {
      await fetch(`${API_BASE}/folders/${clipboard.folderId}/duplicate`, { method: 'POST' });
    } else {
      await fetch(`${API_BASE}/folders/${clipboard.folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      });
      onClipboardChange(null);
    }
    onRefresh();
  }

  function toggleSelect(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  // Finder-style click selection: plain click selects ONLY this file (replaces whatever was selected),
  // Cmd/Ctrl-click toggles this file into/out of the existing selection, Shift-click selects the
  // contiguous range from the last plain/cmd click (selectAnchor) through this file.
  function selectOnClick(e: React.MouseEvent, uid: string) {
    if (e.shiftKey && selectAnchor) {
      const ids = openFiles.map((f) => f.uid);
      const a = ids.indexOf(selectAnchor);
      const b = ids.indexOf(uid);
      if (a !== -1 && b !== -1) {
        const [start, end] = a < b ? [a, b] : [b, a];
        setSelected(new Set(ids.slice(start, end + 1)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      toggleSelect(uid);
    } else {
      setSelected(new Set([uid]));
    }
    setSelectAnchor(uid);
  }

  function selectedFiles() {
    return openFiles.filter((f) => selected.has(f.uid));
  }

  async function downloadSelectedBulk() {
    if (!open) return;
    for (const f of selectedFiles()) await downloadFile(open.id, f.path);
  }

  function bulkCopyOrCut(action: 'copy' | 'cut') {
    if (!open) return;
    const items: ClipboardFileItem[] = selectedFiles().map((f) => ({ folderId: open.id, path: f.path, name: f.path.split('/').pop() ?? f.path }));
    onClipboardChange({ kind: 'file', action, items });
    setSelected(new Set());
  }

  async function bulkMoveOrCopyToCloud(destProviderId: string, action: 'copy' | 'move') {
    if (!open) return;
    const targets = selectedFiles();
    let items: (typeof targets[number] & { destName: string })[] | null = targets.map((f) => ({ ...f, destName: f.path.split('/').pop() ?? f.path }));
    if (action === 'copy') {
      const resolved = await resolveDestNames({ providerId: destProviderId }, targets.map((f) => ({ ...f, name: f.path.split('/').pop() ?? f.path })));
      if (!resolved) return;
      items = resolved;
    }
    setBulkAction(null);
    const label = action === 'copy' ? 'Copying' : 'Moving';
    setProgress({ label, done: 0, total: items.length });
    await runWithProgress(
      items,
      (f) =>
        fetch(`${API_BASE}/files/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceFolderId: open.id, key: f.path, destProviderId, destName: f.destName }),
        }).then(() => undefined),
      (done, total) => setProgress({ label, done, total }),
    );
    setProgress(null);
    setSelected(new Set());
    onRefresh();
  }

  async function bulkAddToPinnedFolder(destFolderId: string, action: 'copy' | 'move') {
    if (!open) return;
    const targets = selectedFiles();
    let items: (typeof targets[number] & { destName: string })[] | null = targets.map((f) => ({ ...f, destName: f.path.split('/').pop() ?? f.path }));
    if (action === 'copy') {
      const resolved = await resolveDestNames({ folderId: destFolderId }, targets.map((f) => ({ ...f, name: f.path.split('/').pop() ?? f.path })));
      if (!resolved) return;
      items = resolved;
    }
    setBulkAction(null);
    const label = action === 'copy' ? 'Adding to folder' : 'Moving';
    setProgress({ label, done: 0, total: items.length });
    await runWithProgress(
      items,
      (f) =>
        fetch(`${API_BASE}/files/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceFolderId: open.id, key: f.path, destFolderId, destName: f.destName }),
        }).then(() => undefined),
      (done, total) => setProgress({ label, done, total }),
    );
    setProgress(null);
    setSelected(new Set());
    onRefresh();
  }

  async function bulkDeleteSelected() {
    if (!open) return;
    const targets = selectedFiles();
    if (!window.confirm(`Move ${targets.length} file(s) to Trash?`)) return;
    setProgress({ label: 'Deleting', done: 0, total: targets.length });
    await runWithProgress(
      targets,
      (f) =>
        fetch(`${API_BASE}/files/trash`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: open.id, key: f.path }),
        }).then(() => undefined),
      (done, total) => setProgress({ label: 'Deleting', done, total }),
    );
    setProgress(null);
    setSelected(new Set());
    onRefresh();
  }

  function fileMenuItems(folderId: string, folderProvider: string, folderName: string, f: { path: string; size: number; modifiedAt: string; hash: string; mimeType?: string }) {
    const name = f.path.split('/').pop() ?? f.path;
    const sendFile: SendableFile = { kind: 'cloud', folderId, key: f.path, mimeType: f.mimeType };
    const sendItems = buildSendMenuItems(devices, sendFile, name, () => setNearbyTarget({ file: sendFile, name }));
    return [
      {
        label: 'Preview',
        onClick: () =>
          setPreview({ source: { kind: 'folder', folderId }, key: f.path, name, size: f.size, provider: folderProvider, folderName, modifiedAt: f.modifiedAt, hash: f.hash }),
      },
      { label: 'Open in App', onClick: () => openInApp(folderId, f.path, f.mimeType) },
      { label: 'Download', onClick: () => downloadFile(folderId, f.path) },
      { label: 'Copy to Clipboard', onClick: () => copyFileToClipboard({ folderId, key: f.path, mimeType: f.mimeType }) },
      { divider: true },
      ...sendItems,
      { divider: true },
      { label: 'Rename File', onClick: () => setRenameTarget(f.path) },
      { label: 'Copy', onClick: () => onClipboardChange({ kind: 'file', action: 'copy', items: [{ folderId, path: f.path, name }] }) },
      { label: 'Cut', onClick: () => onClipboardChange({ kind: 'file', action: 'cut', items: [{ folderId, path: f.path, name }] }) },
      { divider: true },
      { label: 'Delete', danger: true, onClick: () => trashFile(folderId, f.path) },
      { label: 'Details', onClick: () => setDetailsTarget(f.path) },
    ];
  }

  if (open) {
    const files = openFiles;
    return (
      <section className="view active">
        <div className="view-header">
          <div>
            <button className="btn small" onClick={() => setOpenId(null)} style={{ marginBottom: 10 }}>
              <IconChevronLeft size={12} /> Back
            </button>
            <h1>{open.name}</h1>
            <p>{open.provider} · {files.length} file{files.length === 1 ? '' : 's'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {clipboard?.kind === 'file' && (
              <button className="btn" onClick={() => pasteFileHere(open.id)}>
                {clipboard.items.length > 1 ? `Paste ${clipboard.items.length} Files Here` : 'Paste File Here'}
              </button>
            )}
            <button className="btn primary" onClick={() => setShowUpload(true)}>
              <IconUpload size={14} /> Add Files
            </button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="bulk-bar visible">
            <span>{selected.size} selected</span>
            <div className="spacer" />
            <button className="btn small" onClick={downloadSelectedBulk}>Download</button>
            <button className="btn small" onClick={() => bulkCopyOrCut('copy')}>Copy</button>
            <button className="btn small" onClick={() => bulkCopyOrCut('cut')}>Cut</button>
            <button className="btn small" onClick={() => setBulkAction('move-cloud')}>Move to Another Cloud</button>
            <button className="btn small" onClick={() => setBulkAction('copy-pinned')}>Add to Pinned Folder</button>
            <button className="btn small danger-outline" onClick={bulkDeleteSelected}>Delete</button>
          </div>
        )}

        {files.length === 0 && <div className="glass-card empty-state">This folder is empty — click "Add Files" to put something in it.</div>}

        {files.length > 0 && (
          <div
            className="folder-grid"
            ref={(el) => { marqueeSelect.containerRef.current = el; }}
            onMouseDown={marqueeSelect.onMouseDown}
          >
            {files.map((f) => {
              const name = f.path.split('/').pop() ?? f.path;
              return (
                <div
                  key={f.uid}
                  data-select-id={f.uid}
                  className={`folder-card glass-card${selected.has(f.uid) ? ' selected' : ''}`}
                  onClick={(e) => selectOnClick(e, f.uid)}
                  onDoubleClick={() => openInApp(open.id, f.path, f.mimeType)}
                >
                  <DropdownMenu items={fileMenuItems(open.id, open.provider, open.name, f)} />
                  <Thumbnail folderId={open.id} fileKey={f.path} name={name} size={f.size} thumbnailUrl={f.thumbnailUrl} />
                  <div className="folder-name">{name}</div>
                  <div className="folder-meta">{formatBytes(f.size)}</div>
                </div>
              );
            })}
          </div>
        )}

        <MarqueeRect rect={marqueeSelect.marquee} />

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
            excludeFolderId={open.id}
            onClose={() => setBulkAction(null)}
            onConfirm={(destFolderId) => bulkAddToPinnedFolder(destFolderId, 'copy')}
          />
        )}

        {preview && preview.source.kind === 'folder' && (
          <PreviewModal
            file={preview}
            apiBase={API_BASE}
            onClose={() => setPreview(null)}
            onOpenInApp={() => openInApp(preview.source.kind === 'folder' ? preview.source.folderId : '', preview.key)}
          />
        )}
        {showUpload && (
          <UploadModal
            storage={storage}
            apiBase={API_BASE}
            defaultProviderId={open.provider}
            onClose={() => setShowUpload(false)}
            onUploaded={onRefresh}
          />
        )}
        {renameTarget && (
          <RenameModal
            currentName={renameTarget.split('/').pop() ?? renameTarget}
            onClose={() => setRenameTarget(null)}
            onConfirm={async (newName) => {
              await fetch(`${API_BASE}/files/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderId: open.id, key: renameTarget, newName }),
              });
              setRenameTarget(null);
              onRefresh();
            }}
          />
        )}
        {detailsTarget && (
          <FileDetailsModal folderId={open.id} fileKey={detailsTarget} onClose={() => setDetailsTarget(null)} />
        )}
        {progress && <ProgressModal label={progress.label} done={progress.done} total={progress.total} />}

        {nearbyTarget && (
          <NearbyPickerModal file={nearbyTarget.file} fileName={nearbyTarget.name} onClose={() => setNearbyTarget(null)} />
        )}
      </section>
    );
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>Pinned Folders</h1>
          <p>Quick access to the folders you use most</p>
        </div>
        {clipboard?.kind === 'folder' && (
          <button className="btn primary" onClick={pasteFolder}>
            Paste Folder Here
          </button>
        )}
      </div>
      <div className="folder-grid">
        {loading && folders.length === 0 && [0, 1, 2, 3].map((i) => (
          <div className="folder-card glass-card skeleton-folder-card" key={`sk-${i}`}>
            <Skeleton width={30} height={30} radius={8} />
            <Skeleton width="70%" height={12} />
            <Skeleton width="45%" height={10} />
          </div>
        ))}
        {!loading && folders.filter((f) => f.pinned !== false).map((f, i) => {
          const files = filesByFolder[f.id] ?? [];
          return (
            <div key={f.id} className="folder-card glass-card" onClick={() => setOpenId(f.id)}>
              <span className="folder-tag" style={{ background: TAG_COLORS[i % TAG_COLORS.length] }} />
              <FolderCardMenu folder={f} onChanged={onRefresh} onClipboardChange={onClipboardChange} />
              <div className="folder-icon">
                <IconFolder size={30} />
              </div>
              <div className="folder-name">{f.name}</div>
              <div className="folder-meta">
                {f.provider} · {files.length} files
                {f.autoSync && <span style={{ color: 'var(--online)', marginLeft: 6 }}>· ⟲ Auto-Sync</span>}
              </div>
            </div>
          );
        })}
        <div className="folder-card add" onClick={() => setShowAddFolder(true)}>
          <div className="folder-icon">
            <IconAdd size={26} />
          </div>
          <div className="folder-name">Add Folder</div>
        </div>
      </div>

      {showAddFolder && (
        <AddFolderModal
          folders={folders}
          storage={storage}
          onClose={() => setShowAddFolder(false)}
          onDone={onRefresh}
        />
      )}
    </section>
  );
}
