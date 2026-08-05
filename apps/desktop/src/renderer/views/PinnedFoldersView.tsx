import React, { useEffect, useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import type { FolderMeta, FilesByFolder, ClipboardEntry, ClipboardFileItem } from '../lib/types';
import { formatBytes } from '../lib/format';
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
    const files = (filesByFolder[open.id] ?? []).map((f, i) => ({ ...f, uid: `${open.id}::${i}::${f.path}` }));
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

        {files.length === 0 && <div className="glass-card empty-state">This folder is empty — click "Add Files" to put something in it.</div>}

        {files.length > 0 && (
          <div className="folder-grid">
            {files.map((f) => {
              const name = f.path.split('/').pop() ?? f.path;
              return (
                <div
                  key={f.uid}
                  className="folder-card glass-card"
                  onClick={() => openInApp(open.id, f.path, f.mimeType)}
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

        {preview && <PreviewModal file={preview} apiBase={API_BASE} onClose={() => setPreview(null)} />}
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
