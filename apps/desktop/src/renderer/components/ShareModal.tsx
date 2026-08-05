import React, { useEffect, useState } from 'react';
import type { PairedDeviceInfo, RemoteFolder } from '../lib/types';
import { Modal } from './Modal';
import { FilePreviewStrip } from './FilePreviewStrip';

const API_BASE = 'http://localhost:4310';

interface FileStatus {
  name: string;
  state: 'pending' | 'sending' | 'done' | 'error';
  error?: string;
}

export function ShareModal({
  device,
  files: initialFiles,
  onClose,
}: {
  device: PairedDeviceInfo;
  files: File[];
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [folders, setFolders] = useState<RemoteFolder[]>([]);
  const [destFolderId, setDestFolderId] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'sending' | 'done' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FileStatus[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/devices/${device.id}/folders`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFolders(data.folders ?? []);
        setDestFolderId(data.folders?.[0]?.id ?? '');
        setStatus('ready');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
  }, [device.id]);

  function removeFile(index: number) {
    setFiles((f) => f.filter((_, i) => i !== index));
  }

  async function send() {
    if (!destFolderId || files.length === 0) return;
    setStatus('sending');
    setProgress(files.map((f) => ({ name: f.name, state: 'pending' })));

    for (const file of files) {
      setProgress((p) => p.map((it) => (it.name === file.name ? { ...it, state: 'sending' } : it)));
      try {
        const buf = await file.arrayBuffer();
        const res = await fetch(
          `${API_BASE}/devices/${device.id}/share?destFolderId=${destFolderId}&name=${encodeURIComponent(file.name)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'share failed');
        setProgress((p) => p.map((it) => (it.name === file.name ? { ...it, state: 'done' } : it)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProgress((p) => p.map((it) => (it.name === file.name ? { ...it, state: 'error', error: message } : it)));
      }
    }
    setStatus('done');
  }

  return (
    <Modal
      title={`Share to ${device.name}`}
      onClose={onClose}
      footer={
        status === 'done' ? (
          <button className="btn primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={status !== 'ready' || !destFolderId || files.length === 0} onClick={send}>
              {status === 'sending' ? 'Sending…' : `Send${files.length > 1 ? ` (${files.length})` : ''}`}
            </button>
          </>
        )
      }
    >
      {status !== 'done' && status !== 'sending' && (
        <FilePreviewStrip files={files} onRemove={removeFile} />
      )}

      {status === 'loading' && <div className="empty-state">Loading {device.name}'s folders…</div>}
      {status === 'error' && <div style={{ color: 'var(--offline)', fontSize: 12.5 }}>{error}</div>}

      {(status === 'sending' || status === 'done') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {progress.map((p) => (
            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span>{p.name}</span>
              <span style={{ color: p.state === 'error' ? 'var(--offline)' : 'var(--text-secondary)' }}>
                {p.state === 'done' ? '✓ Done' : p.state === 'error' ? (p.error ?? 'Failed') : p.state === 'sending' ? 'Sending…' : 'Waiting…'}
              </span>
            </div>
          ))}
        </div>
      )}

      {status === 'ready' && files.length === 0 && (
        <div className="empty-state">No files left to send</div>
      )}

      {status === 'ready' && files.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
          <label>Save to</label>
          <select className="select-field" value={destFolderId} onChange={(e) => setDestFolderId(e.target.value)}>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name} ({f.provider})</option>
            ))}
          </select>
        </div>
      )}
    </Modal>
  );
}
