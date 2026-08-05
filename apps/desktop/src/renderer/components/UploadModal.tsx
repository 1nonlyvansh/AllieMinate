import React, { useEffect, useRef, useState } from 'react';
import type { ProviderStorage, FolderNode, FileEntry } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import { formatBytes, broadCategorize } from '../lib/format';
import { Modal } from './Modal';
import {
  IconChevronLeft,
  IconFolder,
  IconAdd,
  IconImage,
  IconVideo,
  IconAudio,
  IconDocument,
  IconArchive,
  IconFiles,
  IconCloud,
} from '../icons';

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};

function categoryIcon(category: string, size: number) {
  if (category === 'image') return <IconImage size={size} />;
  if (category === 'video') return <IconVideo size={size} />;
  if (category === 'audio') return <IconAudio size={size} />;
  if (category === 'document') return <IconDocument size={size} />;
  if (category === 'archive') return <IconArchive size={size} />;
  return <IconFiles size={size} />;
}

interface QueueItem {
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
}

interface Crumb {
  id: string | null;
  name: string;
}

export function UploadModal({
  storage,
  apiBase,
  onClose,
  onUploaded,
  defaultProviderId,
}: {
  storage: ProviderStorage[];
  apiBase: string;
  onClose: () => void;
  onUploaded: () => void;
  defaultProviderId?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [providerId, setProviderId] = useState<string | null>(defaultProviderId ?? null);
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: 'Top Level' }]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<FileEntry[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);

  const currentFolderId = path[path.length - 1].id;
  const selectedStorage = storage.find((s) => s.provider === providerId);

  async function loadTree(pid: string, folderId: string | null) {
    setBrowsing(true);
    try {
      const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
      const res = await fetch(`${apiBase}/providers/${pid}/tree${qs}`);
      const data = await res.json();
      setFolders(data.folders ?? []);
      setRemoteFiles(data.files ?? []);
    } finally {
      setBrowsing(false);
    }
  }

  useEffect(() => {
    if (providerId) loadTree(providerId, currentFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, currentFolderId]);

  function pickFiles(list: FileList | File[]) {
    const picked = Array.from(list).slice(0, 50);
    if (picked.length) setFiles(picked);
  }

  function openProvider(id: string) {
    setProviderId(id);
    setPath([{ id: null, name: PROVIDER_LABEL[baseProviderOf(id)] ?? id }]);
  }

  function backToServices() {
    setProviderId(null);
    setFolders([]);
    setRemoteFiles([]);
  }

  function enterFolder(folder: FolderNode) {
    setPath((p) => [...p, { id: folder.id, name: folder.name }]);
  }

  function jumpTo(index: number) {
    setPath((p) => p.slice(0, index + 1));
  }

  async function createFolder() {
    if (!providerId || !newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await fetch(`${apiBase}/providers/${providerId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: currentFolderId, name: newFolderName.trim() }),
      });
      if (res.ok) {
        setNewFolderName('');
        setNewFolderOpen(false);
        await loadTree(providerId, currentFolderId);
      }
    } finally {
      setCreatingFolder(false);
    }
  }

  async function saveHere() {
    if (!providerId || files.length === 0) return;
    setUploading(true);
    setQueue(files.map((f) => ({ name: f.name, status: 'pending' })));

    for (const file of files) {
      setQueue((q) => q.map((it) => (it.name === file.name ? { ...it, status: 'uploading' } : it)));
      try {
        const buf = await file.arrayBuffer();
        const qs = new URLSearchParams({ name: file.name });
        if (currentFolderId) qs.set('folderId', currentFolderId);
        const res = await fetch(`${apiBase}/providers/${providerId}/upload?${qs.toString()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buf,
        });
        if (!res.ok) throw new Error('upload failed');
        setQueue((q) => q.map((it) => (it.name === file.name ? { ...it, status: 'done' } : it)));
      } catch {
        setQueue((q) => q.map((it) => (it.name === file.name ? { ...it, status: 'error' } : it)));
      }
    }
    setUploading(false);
    onUploaded();
  }

  const phase: 'pick-files' | 'pick-service' | 'browse' | 'uploading' =
    files.length === 0 ? 'pick-files' : queue.length > 0 ? 'uploading' : providerId ? 'browse' : 'pick-service';

  let footer: React.ReactNode = <button className="btn" onClick={onClose}>Close</button>;
  if (phase === 'pick-service') {
    footer = <button className="btn" onClick={() => setFiles([])}>Cancel</button>;
  } else if (phase === 'browse') {
    footer = (
      <>
        <button className="btn" onClick={backToServices}>Change Service</button>
        <button className="btn primary" disabled={browsing} onClick={saveHere}>
          Save Here{currentFolderId ? '' : ' (Top Level)'}
        </button>
      </>
    );
  } else if (phase === 'uploading') {
    footer = <button className="btn" disabled={uploading} onClick={onClose}>{uploading ? 'Uploading…' : 'Done'}</button>;
  }

  return (
    <Modal title="Upload Files" onClose={onClose} size="lg" footer={footer}>
      {phase === 'pick-files' && (
        <>
          <div
            className={`dropzone${dragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInput.current?.click()}
            style={{ cursor: 'pointer' }}
          >
            <div>Drag & drop files here, or click to browse</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>Up to 50 files — pick a cloud service next</div>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && pickFiles(e.target.files)}
          />
        </>
      )}

      {phase !== 'pick-files' && (
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          {files.length} file{files.length === 1 ? '' : 's'} selected: {files.map((f) => f.name).join(', ')}
        </div>
      )}

      {phase === 'pick-service' && (
        <div className="folder-grid">
          {storage.length === 0 && <div className="empty-state">No cloud services connected yet</div>}
          {storage.map((s) => (
            <div key={s.provider} className="folder-card glass-card" style={{ cursor: 'pointer' }} onClick={() => openProvider(s.provider)}>
              <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconCloud size={30} />
              </div>
              <div className="folder-name">{s.label ?? PROVIDER_LABEL[baseProviderOf(s.provider)] ?? s.provider}</div>
              <div className="folder-meta">{formatBytes(Math.max(0, s.totalBytes - s.usedBytes))} free</div>
            </div>
          ))}
        </div>
      )}

      {phase === 'browse' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 12.5 }}>
            {path.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <IconChevronLeft size={10} />}
                <button
                  disabled={i === path.length - 1}
                  onClick={() => jumpTo(i)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: i === path.length - 1 ? 'var(--text)' : 'var(--accent)',
                    cursor: i === path.length - 1 ? 'default' : 'pointer',
                    fontWeight: i === path.length - 1 ? 600 : 400,
                  }}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
            <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setNewFolderOpen((v) => !v)}>
              <IconAdd size={12} /> New Folder
            </button>
          </div>

          {newFolderOpen && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="select-field"
                autoFocus
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createFolder()}
                style={{ flex: 1 }}
              />
              <button className="btn small primary" disabled={creatingFolder || !newFolderName.trim()} onClick={createFolder}>
                Create
              </button>
            </div>
          )}

          {browsing && <div className="empty-state">Loading…</div>}

          {!browsing && folders.length === 0 && remoteFiles.length === 0 && (
            <div className="empty-state">Empty folder — click Save Here to save inside it</div>
          )}

          {!browsing && (folders.length > 0 || remoteFiles.length > 0) && (
            <div className="folder-grid">
              {folders.map((f) => (
                <div key={f.id} className="folder-card glass-card" style={{ cursor: 'pointer' }} onClick={() => enterFolder(f)}>
                  <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconFolder size={30} />
                  </div>
                  <div className="folder-name" title={f.name}>{f.name}</div>
                </div>
              ))}
              {remoteFiles.map((f) => {
                const category = broadCategorize(f.path, f.mimeType);
                return (
                  <div key={f.path} className="folder-card glass-card" style={{ opacity: 0.55, cursor: 'default' }} title="Existing file — for reference only">
                    <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {categoryIcon(category, 30)}
                    </div>
                    <div className="folder-name" title={f.path}>{f.path}</div>
                    <div className="folder-meta">{formatBytes(f.size)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedStorage && (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', textAlign: 'right' }}>
              {formatBytes(Math.max(0, selectedStorage.totalBytes - selectedStorage.usedBytes))} free of {formatBytes(selectedStorage.totalBytes)}
            </div>
          )}
        </>
      )}

      {phase === 'uploading' && queue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {queue.map((item) => (
            <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span>{item.name}</span>
              <span style={{ color: item.status === 'error' ? 'var(--offline)' : 'var(--text-secondary)' }}>
                {item.status === 'done' ? '✓ Done' : item.status === 'error' ? 'Failed' : item.status === 'uploading' ? 'Uploading…' : 'Waiting…'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
