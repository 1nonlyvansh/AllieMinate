import React, { useEffect, useState } from 'react';
import type { PairedDeviceInfo, RemoteFolder, ClipboardEntry } from '../lib/types';
import type { FileEntry, ProviderStorage } from '@alliminate/shared';
import { formatBytes, broadCategorize } from '../lib/format';
import { IconMac, IconWindows, IconPhone, IconDevices, IconChevronLeft, IconAdd, IconImage, IconVideo, IconAudio, IconDocument, IconArchive, IconFiles } from '../icons';
import { PairDeviceModal } from '../components/PairDeviceModal';
import { PairAndroidModal } from '../components/PairAndroidModal';
import { RenameModal } from '../components/RenameModal';
import { DropdownMenu } from '../components/DropdownMenu';
import { Modal } from '../components/Modal';
import { ProviderPickerModal } from '../components/ProviderPickerModal';
import { timeAgo } from '../lib/format';

const API_BASE = 'http://localhost:4310';
const POLL_MS = 5000;

interface DeviceFileEntry extends FileEntry {
  devicePath?: string;
}

interface TransferEntry {
  id: string;
  deviceId: string;
  deviceName: string;
  fileName: string;
  direction: 'sent' | 'received';
  date: string;
  size: number;
  path: string;
}

function categoryIcon(category: string, size: number) {
  if (category === 'image') return <IconImage size={size} />;
  if (category === 'video') return <IconVideo size={size} />;
  if (category === 'audio') return <IconAudio size={size} />;
  if (category === 'document') return <IconDocument size={size} />;
  if (category === 'archive') return <IconArchive size={size} />;
  return <IconFiles size={size} />;
}

// first-frame video thumbnail for a LOCAL file path — same canvas-capture trick as the Share preview
// strip's VideoFrameThumb, just fed a file:// URL instead of an object URL from a picked File.
function TransferVideoThumb({ path, size }: { path: string; size: number }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const url = `file://${encodeURI(path)}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => { video.currentTime = Math.min(0.1, video.duration || 0); };
    const onSeeked = () => {
      const canvas = canvasRef.current;
      if (!canvas || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      setFrameUrl(canvas.toDataURL('image/jpeg', 0.7));
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [url]);

  if (frameUrl) return <img src={frameUrl} alt="" style={{ width: '100%', height: size, objectFit: 'cover', borderRadius: 6 }} />;
  return (
    <>
      <video ref={videoRef} src={url} muted playsInline style={{ display: 'none' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {categoryIcon('video', size * 0.6)}
    </>
  );
}

function platformIcon(platform: string, size: number) {
  if (platform === 'darwin') return <IconMac size={size} />;
  if (platform === 'win32') return <IconWindows size={size} />;
  if (platform === 'android' || platform === 'ios') return <IconPhone size={size} />;
  return <IconDevices size={size} />;
}

// fixed display order/icon for the well-known categories the phone always reports (see
// LocalHttpServer.kt's MEDIA_CATEGORIES) — "received" first since that's this app's own inbox, then the
// sidebar categories in the same order the user asked for.
const CATEGORY_ORDER = ['received', 'images', 'videos', 'audio', 'documents', 'archives'];
const CATEGORY_ICON: Record<string, string> = {
  received: 'document',
  images: 'image',
  videos: 'video',
  audio: 'audio',
  documents: 'document',
  archives: 'archive',
};

// inline preview only — mirrors TrashView's TrashPreviewModal pattern, just sourced from a paired device
// instead of the trash bin.
function DevicePreviewModal({ device, folderId, file, onClose }: { device: PairedDeviceInfo; folderId: string; file: DeviceFileEntry; onClose: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const category = broadCategorize(file.path, file.mimeType);
  const name = file.path.split('/').pop() ?? file.path;

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setStatus('loading');
    fetch(`${API_BASE}/devices/${device.id}/folders/${folderId}/download?key=${encodeURIComponent(file.path)}`)
      .then((res) => {
        if (!res.ok) throw new Error('download failed');
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [device.id, folderId, file.path]);

  const big = category === 'image' || category === 'video';

  return (
    <Modal title={name} onClose={onClose} size={big ? 'lg' : undefined} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className={`preview-area${big ? ' preview-area-lg' : ''}`}>
        {status === 'loading' && <div className="empty-state">Loading preview…</div>}
        {status === 'error' && <div className="empty-state">Couldn't load preview</div>}
        {status === 'ready' && blobUrl && category === 'image' && (
          <img src={blobUrl} style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 8, display: 'block', margin: '0 auto' }} />
        )}
        {status === 'ready' && blobUrl && category === 'video' && (
          <video src={blobUrl} controls style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 8, display: 'block', margin: '0 auto' }} />
        )}
        {status === 'ready' && blobUrl && category === 'audio' && <audio src={blobUrl} controls style={{ width: '100%' }} />}
        {status === 'ready' && blobUrl && category === 'document' && file.mimeType === 'application/pdf' && (
          <embed src={`${blobUrl}#toolbar=1&view=FitH`} type="application/pdf" style={{ width: '100%', height: '65vh', border: 'none', borderRadius: 8 }} />
        )}
        {status === 'ready' && (category !== 'image' && category !== 'video' && category !== 'audio') && file.mimeType !== 'application/pdf' && (
          <div className="empty-state">
            {categoryIcon(category, 30)}
            <div style={{ marginTop: 10 }}>No inline preview for this file type.</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeviceDetailsModal({ file, onClose }: { file: DeviceFileEntry; onClose: () => void }) {
  const name = file.path.split('/').pop() ?? file.path;
  return (
    <Modal title="Details" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <table className="prop-table">
        <tbody>
          <tr><td>Name</td><td>{name}</td></tr>
          <tr><td>Size</td><td>{formatBytes(file.size)}</td></tr>
          <tr><td>Created on phone</td><td>{file.createdAt ? new Date(file.createdAt).toLocaleString() : '—'}</td></tr>
          <tr><td>Modified</td><td>{new Date(file.modifiedAt).toLocaleString()}</td></tr>
          <tr><td>Location on phone</td><td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{file.devicePath || '—'}</td></tr>
        </tbody>
      </table>
    </Modal>
  );
}

function RemoteBrowser({
  device,
  onBack,
  onClipboardChange,
}: {
  device: PairedDeviceInfo;
  onBack: () => void;
  onClipboardChange: (c: ClipboardEntry) => void;
}) {
  const [folders, setFolders] = useState<RemoteFolder[] | null>(null);
  const [activeFolder, setActiveFolder] = useState<RemoteFolder | null>(null);
  const [files, setFiles] = useState<DeviceFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<DeviceFileEntry | null>(null);
  const [detailsFile, setDetailsFile] = useState<DeviceFileEntry | null>(null);
  const [copyingToCloud, setCopyingToCloud] = useState(false);
  const [storage, setStorage] = useState<ProviderStorage[]>([]);
  const [openWithApps, setOpenWithApps] = useState<Record<string, { name: string; path: string }[]>>({});
  const [openWithPrefs, setOpenWithPrefs] = useState<Record<string, string>>({});
  const [renamingFile, setRenamingFile] = useState<DeviceFileEntry | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/storage`)
      .then((res) => res.json())
      .then((data) => setStorage(data.providers ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/open-with`)
      .then((res) => res.json())
      .then((data) => {
        setOpenWithApps(data.apps ?? {});
        setOpenWithPrefs(data.prefs ?? {});
      })
      .catch(() => {});
  }, []);

  // same "Open With Preview" / "Open With Google Chrome" label logic FilesView.tsx uses for cloud files —
  // reflects whatever's actually set in Settings → Default Apps, purely by file extension, so it applies
  // identically to a phone-hosted file.
  function openWithLabel(f: DeviceFileEntry): string {
    const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
    const category = { pdf: 'pdf', doc: 'docx', docx: 'docx', xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet', ppt: 'pptx', pptx: 'pptx', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image' }[ext];
    if (!category) return 'Open in App';
    const candidates = openWithApps[category] ?? [];
    const chosenPath = openWithPrefs[category];
    const app = candidates.find((a) => a.path === chosenPath) ?? candidates[0];
    return app ? `Open With ${app.name}` : 'Open in App';
  }

  useEffect(() => {
    fetch(`${API_BASE}/devices/${device.id}/folders`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const list: RemoteFolder[] = data.folders ?? [];
        list.sort((a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id));
        setFolders(list);
        if (list.length > 0) openCategory(list[0]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id]);

  function openCategory(f: RemoteFolder) {
    setActiveFolder(f);
    setSelected(new Set());
    setFilesLoading(true);
    setFilesError(null);
    fetch(`${API_BASE}/devices/${device.id}/folders/${f.id}/files`)
      .then((res) => res.json())
      .then((data) => {
        // some categories (permission not granted, or a non-fatal per-category read error) come back
        // with BOTH an `error` explaining why and an empty `files` list — that's not fatal to the whole
        // browser, just this one category, so it stays inline instead of replacing the sidebar.
        setFiles(data.files ?? []);
        setFilesError(data.error ?? null);
      })
      .catch((err) => setFilesError(err instanceof Error ? err.message : String(err)))
      .finally(() => setFilesLoading(false));
  }

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function downloadRemote(f: DeviceFileEntry) {
    if (!activeFolder) return;
    const res = await fetch(`${API_BASE}/devices/${device.id}/folders/${activeFolder.id}/download?key=${encodeURIComponent(f.path)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.path.split('/').pop() ?? f.path;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openInApp(f: DeviceFileEntry) {
    if (!activeFolder) return;
    await fetch(`${API_BASE}/devices/${device.id}/folders/${activeFolder.id}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: f.path, mimeType: f.mimeType }),
    });
  }

  async function copyToClipboardOne(f: DeviceFileEntry) {
    if (!activeFolder) return;
    try {
      const res = await fetch(`${API_BASE}/devices/${device.id}/folders/${activeFolder.id}/cache-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: f.path, mimeType: f.mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'copy failed');
      const result = await window.alliminate.copyLocalFile(data.path);
      if (!result.ok) throw new Error(result.error);
    } catch (err) {
      window.alert("Couldn't copy this file — " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function deleteOne(f: DeviceFileEntry) {
    if (!activeFolder) return;
    if (!window.confirm(`Delete "${f.path.split('/').pop() ?? f.path}" from ${device.name}? This can't be undone.`)) return;
    const res = await fetch(`${API_BASE}/devices/${device.id}/folders/${activeFolder.id}/file?key=${encodeURIComponent(f.path)}`, { method: 'DELETE' });
    if (!res.ok) {
      window.alert("Couldn't delete that file.");
      return;
    }
    openCategory(activeFolder);
  }

  async function renameOne(f: DeviceFileEntry, newName: string) {
    if (!activeFolder) return;
    const res = await fetch(`${API_BASE}/devices/${device.id}/folders/${activeFolder.id}/file`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: f.path, newName }),
    });
    if (!res.ok) {
      window.alert("Couldn't rename that file.");
      return;
    }
    openCategory(activeFolder);
  }

  function copyOrCut(f: DeviceFileEntry, action: 'copy' | 'cut') {
    if (!activeFolder) return;
    onClipboardChange({
      kind: 'file',
      action,
      items: [{ folderId: activeFolder.id, path: f.path, name: f.path.split('/').pop() ?? f.path, deviceId: device.id, mimeType: f.mimeType }],
    });
  }

  async function bulkDownload() {
    for (const f of files.filter((f) => selected.has(f.path))) await downloadRemote(f);
  }

  async function bulkCopyToClipboard() {
    for (const f of files.filter((f) => selected.has(f.path))) await copyToClipboardOne(f);
  }

  async function bulkCopyToCloud(destProviderId: string) {
    if (!activeFolder) return;
    const targets = files.filter((f) => selected.has(f.path));
    setCopyingToCloud(false);
    for (const f of targets) {
      await fetch(`${API_BASE}/devices/${device.id}/folders/${activeFolder.id}/copy-to-cloud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: f.path, destProviderId }),
      }).catch(() => {});
    }
    setSelected(new Set());
  }

  const isMediaCategory = activeFolder?.id === 'images' || activeFolder?.id === 'videos';

  function menuItemsFor(f: DeviceFileEntry) {
    return [
      { label: 'Preview', onClick: () => setPreviewFile(f) },
      { label: openWithLabel(f), onClick: () => openInApp(f) },
      { label: 'Download', onClick: () => downloadRemote(f) },
      { label: 'Copy to Clipboard', onClick: () => copyToClipboardOne(f) },
      { label: 'Rename File', onClick: () => setRenamingFile(f) },
      { label: 'Copy', onClick: () => copyOrCut(f, 'copy') },
      { label: 'Cut', onClick: () => copyOrCut(f, 'cut') },
      { divider: true },
      { label: 'Delete', danger: true, onClick: () => deleteOne(f) },
      { label: 'Details', onClick: () => setDetailsFile(f) },
    ];
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <button className="btn small" onClick={onBack} style={{ marginBottom: 10 }}>
            <IconChevronLeft size={12} /> Back
          </button>
          <h1>{device.name}</h1>
          <p>{activeFolder ? activeFolder.name : 'Browsing this device'}</p>
        </div>
      </div>

      {error && <div className="glass-card empty-state" style={{ color: 'var(--offline)' }}>{error}</div>}

      {!error && (
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', minHeight: 400 }}>
          <div
            style={{
              width: 176, flexShrink: 0, padding: '4px 10px 4px 0', display: 'flex', flexDirection: 'column', gap: 2,
              borderRight: '1px solid var(--hairline)', marginRight: 20,
              position: 'sticky', top: 0, alignSelf: 'flex-start',
            }}
          >
            {(folders ?? []).map((f) => (
              <div
                key={f.id}
                onClick={() => openCategory(f)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, fontWeight: activeFolder?.id === f.id ? 600 : 400,
                  background: activeFolder?.id === f.id ? 'var(--accent-soft)' : 'transparent',
                  color: activeFolder?.id === f.id ? 'var(--accent-text)' : 'inherit',
                }}
              >
                {categoryIcon(CATEGORY_ICON[f.id] ?? 'other', 15)}
                {f.name}
              </div>
            ))}
            {folders === null && <div className="empty-state" style={{ fontSize: 12 }}>Loading…</div>}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {selected.size > 0 && (
              <div className="bulk-bar visible" style={{ marginBottom: 12 }}>
                <span>{selected.size} selected</span>
                <div className="spacer" />
                <button className="btn small" onClick={bulkDownload}>Download</button>
                <button className="btn small" onClick={bulkCopyToClipboard}>Copy to Clipboard</button>
                <button className="btn small" onClick={() => setCopyingToCloud(true)}>Copy to Cloud Service</button>
              </div>
            )}

            <div className="folder-grid" style={{ alignContent: 'start', alignItems: 'start' }}>
              {filesLoading && <div className="empty-state">Loading…</div>}
              {!filesLoading && files.length === 0 && (
                <div className="empty-state" style={filesError ? { color: 'var(--offline)' } : undefined}>
                  {filesError ?? 'Nothing here yet'}
                </div>
              )}
              {!filesLoading && files.map((f) => {
                const category = broadCategorize(f.path, f.mimeType);
                const name = f.path.split('/').pop() ?? f.path;
                return (
                  <div key={f.path} className="folder-card glass-card" style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setPreviewFile(f)}>
                    <input
                      type="checkbox"
                      checked={selected.has(f.path)}
                      onChange={() => toggleSelect(f.path)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, cursor: 'pointer' }}
                    />
                    <div style={{ position: 'absolute', top: 6, right: 6 }} onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu items={menuItemsFor(f)} />
                    </div>
                    <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48 }}>
                      {isMediaCategory ? (
                        <img
                          src={`${API_BASE}/devices/${device.id}/folders/${activeFolder!.id}/thumbnail?key=${encodeURIComponent(f.path)}`}
                          alt=""
                          style={{ width: '100%', height: 48, objectFit: 'cover', borderRadius: 6 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        categoryIcon(category, 30)
                      )}
                    </div>
                    <div className="folder-name" title={name}>{name}</div>
                    <div className="folder-meta">{formatBytes(f.size)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {previewFile && activeFolder && (
        <DevicePreviewModal device={device} folderId={activeFolder.id} file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      {detailsFile && <DeviceDetailsModal file={detailsFile} onClose={() => setDetailsFile(null)} />}
      {renamingFile && (
        <RenameModal
          currentName={renamingFile.path.split('/').pop() ?? renamingFile.path}
          onClose={() => setRenamingFile(null)}
          onConfirm={(newName) => {
            const target = renamingFile;
            setRenamingFile(null);
            renameOne(target, newName);
          }}
        />
      )}
      {copyingToCloud && (
        <ProviderPickerModal
          title={`Copy ${selected.size} file(s) to a cloud service`}
          confirmLabel="Copy"
          storage={storage}
          excludeProviderId=""
          onClose={() => setCopyingToCloud(false)}
          onConfirm={bulkCopyToCloud}
        />
      )}
    </section>
  );
}

export function DevicesView({ clipboard, onClipboardChange }: { clipboard: ClipboardEntry; onClipboardChange: (c: ClipboardEntry) => void }) {
  const [paired, setPaired] = useState<PairedDeviceInfo[]>([]);
  const [browsing, setBrowsing] = useState<PairedDeviceInfo | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairAndroidOpen, setPairAndroidOpen] = useState(false);
  const [renaming, setRenaming] = useState<PairedDeviceInfo | null>(null);
  const [transfers, setTransfers] = useState<TransferEntry[]>([]);
  const [renamingTransfer, setRenamingTransfer] = useState<TransferEntry | null>(null);
  const [detailsTransfer, setDetailsTransfer] = useState<TransferEntry | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`${API_BASE}/devices`);
      const data = await res.json();
      setPaired(data.paired ?? []);
    } catch {
      // backend unreachable — leave list as-is
    }
  }

  async function refreshTransfers() {
    try {
      const res = await fetch(`${API_BASE}/transfers`);
      const data = await res.json();
      setTransfers(data.transfers ?? []);
    } catch {
      // backend unreachable — leave list as-is
    }
  }

  useEffect(() => {
    refresh();
    refreshTransfers();
    const timer = setInterval(() => {
      refresh();
      refreshTransfers();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function testConnection(id: string) {
    try {
      const res = await fetch(`${API_BASE}/devices/${id}/test`);
      const data = await res.json();
      window.alert(data.ok ? 'Connected — this device is reachable right now.' : `Not reachable: ${data.error ?? 'unknown error'}`);
    } catch (err) {
      window.alert(`Couldn't run the test: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function unpair(id: string) {
    if (!window.confirm('Unpair this device?')) return;
    try {
      const res = await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
    } catch (err) {
      window.alert(`Couldn't unpair: ${err instanceof Error ? err.message : String(err)}`);
    }
    refresh();
  }

  async function copyTransferFile(t: TransferEntry) {
    const result = await window.alliminate.copyLocalFile(t.path);
    if (!result.ok) window.alert(`Couldn't copy: ${result.error}`);
  }

  async function removeFromHistory(id: string) {
    await fetch(`${API_BASE}/transfers/${id}`, { method: 'DELETE' });
    refreshTransfers();
  }

  async function renameTransfer(t: TransferEntry, newName: string) {
    const res = await fetch(`${API_BASE}/transfers/${t.id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) window.alert(`Couldn't rename: ${data.error ?? res.status}`);
    setRenamingTransfer(null);
    refreshTransfers();
  }

  async function renameDevice(id: string, name: string) {
    await fetch(`${API_BASE}/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setRenaming(null);
    refresh();
  }

  if (browsing) {
    return <RemoteBrowser device={browsing} onBack={() => setBrowsing(null)} onClipboardChange={onClipboardChange} />;
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>Devices</h1>
          <p>Machines running AllieMinate</p>
        </div>
      </div>

      <div className="device-strip">
        <div className="device-card glass-card">
          <div className="device-icon">
            <IconMac size={34} />
          </div>
          <div className="device-name">This Mac</div>
          <div className="device-meta">macOS</div>
          <div className="status-pill online">
            <span className="status-dot online" /> Online
          </div>
        </div>

        {paired.map((d) => (
          <div
            key={d.id}
            className="device-card glass-card"
            style={{ position: 'relative', cursor: d.online ? 'pointer' : 'default', opacity: d.online ? 1 : 0.6 }}
            onClick={() => d.online && setBrowsing(d)}
          >
            <div style={{ position: 'absolute', top: 6, right: 6 }} onClick={(e) => e.stopPropagation()}>
              <DropdownMenu
                items={[
                  { label: 'Browse Files', onClick: () => d.online && setBrowsing(d) },
                  { label: 'Rename', onClick: () => setRenaming(d) },
                  { label: 'Test Connection', onClick: () => testConnection(d.id) },
                  { divider: true },
                  { label: 'Unpair', danger: true, onClick: () => unpair(d.id) },
                ]}
              />
            </div>
            <div className="device-icon">{platformIcon(d.platform, 34)}</div>
            <div className="device-name">{d.name}</div>
            <div className="device-meta">{d.platform}</div>
            {d.host && <div className="device-meta" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>{d.host}</div>}
            {d.pairedAt && <div className="device-meta">Paired {timeAgo(d.pairedAt)}</div>}
            <div className={`status-pill ${d.online ? 'online' : 'offline'}`}>
              <span className={`status-dot ${d.online ? 'online' : 'offline'}`} /> {d.online ? 'Online' : 'Offline'}
            </div>
          </div>
        ))}

        <div className="device-card glass-card" style={{ opacity: 0.8, cursor: 'pointer' }} onClick={() => setPairOpen(true)}>
          <div className="device-icon">
            <IconAdd size={34} />
          </div>
          <div className="device-name">Pair a Device</div>
          <div className="device-meta">Mac or Windows, same WiFi</div>
        </div>

        <div className="device-card glass-card" style={{ opacity: 0.8, cursor: 'pointer' }} onClick={() => setPairAndroidOpen(true)}>
          <div className="device-icon">
            <IconPhone size={34} />
          </div>
          <div className="device-name">Pair an Android</div>
          <div className="device-meta">QR code or USB</div>
        </div>
      </div>

      <div className="section-title">Transfer History</div>
      {transfers.length === 0 ? (
        <div className="glass-card empty-state">No files sent or received yet.</div>
      ) : (
        <div className="folder-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {transfers.map((t) => {
            const category = broadCategorize(t.fileName);
            return (
              <div key={t.id} className="folder-card glass-card" style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', top: 6, right: 6 }}>
                  <DropdownMenu
                    items={[
                      { label: 'Copy to Clipboard', onClick: () => copyTransferFile(t) },
                      { label: 'Rename', onClick: () => setRenamingTransfer(t) },
                      { label: 'Details', onClick: () => setDetailsTransfer(t) },
                      { label: 'Show in Finder', onClick: () => window.alliminate.showInFinder(t.path) },
                      { divider: true },
                      { label: 'Remove From History', danger: true, onClick: () => removeFromHistory(t.id) },
                    ]}
                  />
                </div>
                <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 44 }}>
                  {category === 'image' ? (
                    <img
                      src={`file://${encodeURI(t.path)}`}
                      alt=""
                      style={{ width: '100%', height: 44, objectFit: 'cover', borderRadius: 6 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : category === 'video' ? (
                    <TransferVideoThumb path={t.path} size={44} />
                  ) : (
                    categoryIcon(category, 26)
                  )}
                </div>
                <div
                  className="folder-name"
                  title={t.fileName}
                  style={{ WebkitLineClamp: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {t.fileName}
                </div>
                <div className="folder-meta" style={{ color: t.direction === 'sent' ? 'var(--accent)' : 'var(--online)' }}>
                  {t.direction === 'sent' ? 'Sent →' : '← Received'} · {t.deviceName}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pairOpen && <PairDeviceModal onClose={() => setPairOpen(false)} onPaired={refresh} />}
      {pairAndroidOpen && <PairAndroidModal onClose={() => setPairAndroidOpen(false)} onPaired={refresh} />}

      {renaming && (
        <RenameModal
          currentName={renaming.name}
          onClose={() => setRenaming(null)}
          onConfirm={(name) => renameDevice(renaming.id, name)}
        />
      )}

      {renamingTransfer && (
        <RenameModal
          currentName={renamingTransfer.fileName}
          onClose={() => setRenamingTransfer(null)}
          onConfirm={(name) => renameTransfer(renamingTransfer, name)}
        />
      )}

      {detailsTransfer && (
        <Modal title="File Details" onClose={() => setDetailsTransfer(null)} footer={<button className="btn" onClick={() => setDetailsTransfer(null)}>Close</button>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div><strong>Name:</strong> {detailsTransfer.fileName}</div>
            <div><strong>Size:</strong> {formatBytes(detailsTransfer.size)}</div>
            <div><strong>Direction:</strong> {detailsTransfer.direction === 'sent' ? 'Sent to' : 'Received from'} {detailsTransfer.deviceName}</div>
            <div><strong>Date &amp; time:</strong> {new Date(detailsTransfer.date).toLocaleString()}</div>
            <div style={{ wordBreak: 'break-all' }}><strong>Path:</strong> {detailsTransfer.path}</div>
          </div>
        </Modal>
      )}
    </section>
  );
}
