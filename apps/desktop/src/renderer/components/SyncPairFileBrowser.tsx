import React, { useEffect, useState } from 'react';
import type { SyncPair } from '../lib/types';
import { formatBytes, broadCategorize } from '../lib/format';
import { fileBrowserName } from '../lib/platformLabels';
import { Modal } from './Modal';
import { DropdownMenu } from './DropdownMenu';
import { RenameModal } from './RenameModal';
import { Thumbnail } from './Thumbnail';
import { IconFiles } from '../icons';

const API_BASE = 'http://localhost:4310';

interface PairFile {
  relPath: string;
  localSize?: number;
  localModifiedAt?: string;
  addedByDeviceId?: string;
  addedByDeviceName?: string;
  addedAt?: string;
  status?: string;
}

function fileName(relPath: string): string {
  return relPath.split('/').pop() ?? relPath;
}

// Full local-file browser + context menu for a Sync Pair's contents — the pieces the Sync Pair card
// itself doesn't cover (that only shows aggregate counts + "Open Folder in Finder/Explorer"). Every
// action here operates on a real path already on this device's disk (localPath + relPath), so Copy/Show
// in Finder go straight through the existing IPC bridge with no download step; Preview/Details/Rename/
// Delete go through the new /sync/pairs/:id/{download,open,file} routes.
export function SyncPairFileBrowser({ pair, onClose, onChanged }: { pair: SyncPair; onClose: () => void; onChanged: () => void }) {
  const [files, setFiles] = useState<PairFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<PairFile | null>(null);
  const [detailsFile, setDetailsFile] = useState<PairFile | null>(null);
  const [renamingFile, setRenamingFile] = useState<PairFile | null>(null);

  function load() {
    fetch(`${API_BASE}/sync/pairs/${pair.id}/files`)
      .then((res) => res.json())
      .then((data) => setFiles((data.files ?? []).sort((a: PairFile, b: PairFile) => fileName(a.relPath).localeCompare(fileName(b.relPath)))))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(load, [pair.id]);

  function fullPath(f: PairFile): string {
    return `${pair.localPath}/${f.relPath}`;
  }

  function downloadUrl(f: PairFile): string {
    return `${API_BASE}/sync/pairs/${pair.id}/download?key=${encodeURIComponent(f.relPath)}`;
  }

  async function downloadFile(f: PairFile) {
    const res = await fetch(downloadUrl(f));
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(f.relPath);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openInApp(f: PairFile) {
    await fetch(`${API_BASE}/sync/pairs/${pair.id}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: f.relPath }),
    });
  }

  async function copyToClipboard(f: PairFile) {
    const result = await window.alliminate.copyLocalFile(fullPath(f));
    if (!result.ok) window.alert("Couldn't copy this file — " + (result.error ?? 'unknown error'));
  }

  async function deletePermanently(f: PairFile) {
    if (!window.confirm(`Delete "${fileName(f.relPath)}" permanently? This can't be undone, and propagates to every device this folder is shared with.`)) return;
    const res = await fetch(`${API_BASE}/sync/pairs/${pair.id}/file?key=${encodeURIComponent(f.relPath)}`, { method: 'DELETE' });
    if (!res.ok) {
      window.alert("Couldn't delete that file.");
      return;
    }
    load();
    onChanged();
  }

  async function renameFile(f: PairFile, newName: string) {
    const res = await fetch(`${API_BASE}/sync/pairs/${pair.id}/file?key=${encodeURIComponent(f.relPath)}&newName=${encodeURIComponent(newName)}`, {
      method: 'PATCH',
    });
    if (!res.ok) {
      window.alert("Couldn't rename that file.");
      return;
    }
    setRenamingFile(null);
    load();
    onChanged();
  }

  function menuItemsFor(f: PairFile) {
    return [
      { label: `Show in ${fileBrowserName}`, onClick: () => window.alliminate.showInFinder(fullPath(f)) },
      { label: 'Preview', onClick: () => setPreviewFile(f) },
      { label: 'Open in App', onClick: () => openInApp(f) },
      { label: 'Download', onClick: () => downloadFile(f) },
      { label: 'Copy to Clipboard', onClick: () => copyToClipboard(f) },
      { divider: true },
      { label: 'Rename File', onClick: () => setRenamingFile(f) },
      { label: 'Copy', onClick: () => copyToClipboard(f) },
      { divider: true },
      { label: 'Delete Permanently', danger: true, onClick: () => deletePermanently(f) },
      { label: 'Details', onClick: () => setDetailsFile(f) },
    ];
  }

  return (
    <Modal title={pair.name} onClose={onClose} size="lg">
      {error && <div className="empty-state" style={{ color: 'var(--offline)' }}>{error}</div>}
      {!error && files === null && <div className="empty-state">Loading…</div>}
      {!error && files !== null && files.length === 0 && (
        <div className="empty-state">
          <IconFiles size={26} />
          <div style={{ marginTop: 10 }}>Nothing here yet.</div>
        </div>
      )}
      {!error && files !== null && files.length > 0 && (
        <div className="folder-grid">
          {files.map((f) => {
            const name = fileName(f.relPath);
            return (
              <div key={f.relPath} className="folder-card glass-card" style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setPreviewFile(f)}>
                <div style={{ position: 'absolute', top: 6, right: 6 }} onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu items={menuItemsFor(f)} />
                </div>
                <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48 }}>
                  <Thumbnail fileKey={f.relPath} name={name} size={f.localSize ?? 0} directUrl={downloadUrl(f)} />
                </div>
                <div className="folder-name" title={name}>{name}</div>
                <div className="folder-meta">{formatBytes(f.localSize ?? 0)}</div>
              </div>
            );
          })}
        </div>
      )}

      {previewFile && (
        <Modal title={fileName(previewFile.relPath)} onClose={() => setPreviewFile(null)} footer={<button className="btn" onClick={() => setPreviewFile(null)}>Close</button>}>
          <PairFilePreview category={broadCategorize(previewFile.relPath)} url={downloadUrl(previewFile)} />
        </Modal>
      )}

      {detailsFile && (
        <Modal title="Details" onClose={() => setDetailsFile(null)} footer={<button className="btn" onClick={() => setDetailsFile(null)}>Close</button>}>
          <table className="prop-table">
            <tbody>
              <tr><td>Name</td><td>{fileName(detailsFile.relPath)}</td></tr>
              <tr><td>Size</td><td>{formatBytes(detailsFile.localSize ?? 0)}</td></tr>
              <tr><td>Modified</td><td>{detailsFile.localModifiedAt ? new Date(detailsFile.localModifiedAt).toLocaleString() : '—'}</td></tr>
              <tr><td>Added by</td><td>{detailsFile.addedByDeviceName ?? 'Unknown (synced from elsewhere)'}</td></tr>
              <tr><td>Added</td><td>{detailsFile.addedAt ? new Date(detailsFile.addedAt).toLocaleString() : '—'}</td></tr>
              <tr><td>Location</td><td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{fullPath(detailsFile)}</td></tr>
            </tbody>
          </table>
        </Modal>
      )}

      {renamingFile && (
        <RenameModal
          currentName={fileName(renamingFile.relPath)}
          onClose={() => setRenamingFile(null)}
          onConfirm={(newName) => renameFile(renamingFile, newName)}
        />
      )}
    </Modal>
  );
}

function PairFilePreview({ category, url }: { category: string; url: string }) {
  const big = category === 'image' || category === 'video';
  if (category === 'image') return <img src={url} style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 8, display: 'block', margin: '0 auto' }} />;
  if (category === 'video') return <video src={url} controls style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 8, display: 'block', margin: '0 auto' }} />;
  if (category === 'audio') return <audio src={url} controls style={{ width: '100%' }} />;
  if (category === 'document') return <embed src={`${url}#toolbar=1&view=FitH`} type="application/pdf" style={{ width: '100%', height: '65vh', border: 'none', borderRadius: 8 }} />;
  return (
    <div className="empty-state" style={{ padding: big ? undefined : 20 }}>
      <IconFiles size={30} />
      <div style={{ marginTop: 10 }}>No inline preview for this file type.</div>
    </div>
  );
}
