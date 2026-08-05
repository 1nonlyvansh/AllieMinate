import React, { useState } from 'react';
import type { NearbyPeerInfo } from '../lib/types';
import { Modal } from './Modal';
import { FilePreviewStrip } from './FilePreviewStrip';

const API_BASE = 'http://localhost:4310';

interface FileStatus {
  name: string;
  state: 'pending' | 'waiting' | 'sending' | 'done' | 'declined' | 'timed-out' | 'error';
  error?: string;
}

// unlike ShareModal (paired devices, browse their real folders, pick a destination), a nearby peer has no
// folder tree to offer — there's no persistent trust to browse anything of theirs at all. This is a flat
// "send it, they either accept or they don't" flow, matching the accept/decline consent /nearby/send
// implements on the backend.
export function NearbyShareModal({
  peer,
  files: initialFiles,
  onClose,
}: {
  peer: NearbyPeerInfo;
  files: File[];
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [status, setStatus] = useState<'ready' | 'sending' | 'done'>('ready');
  const [progress, setProgress] = useState<FileStatus[]>([]);

  function removeFile(index: number) {
    setFiles((f) => f.filter((_, i) => i !== index));
  }

  async function send() {
    if (files.length === 0) return;
    setStatus('sending');
    setProgress(files.map((f) => ({ name: f.name, state: 'waiting' })));

    for (const file of files) {
      setProgress((p) => p.map((it) => (it.name === file.name ? { ...it, state: 'sending' } : it)));
      try {
        const buf = await file.arrayBuffer();
        const res = await fetch(`${API_BASE}/nearby/send?peerId=${encodeURIComponent(peer.id)}&name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buf,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'send failed');
        const state: FileStatus['state'] = data.status === 'sent' ? 'done' : data.status === 'declined' ? 'declined' : data.status === 'timed-out' ? 'timed-out' : 'error';
        setProgress((p) => p.map((it) => (it.name === file.name ? { ...it, state } : it)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProgress((p) => p.map((it) => (it.name === file.name ? { ...it, state: 'error', error: message } : it)));
      }
    }
    setStatus('done');
  }

  const statusLabel: Record<FileStatus['state'], string> = {
    pending: 'Waiting…',
    waiting: 'Waiting…',
    sending: 'Waiting for them to accept…',
    done: '✓ Sent',
    declined: 'Declined',
    'timed-out': "Didn't respond in time",
    error: 'Failed',
  };

  return (
    <Modal
      title={`Share Nearby to ${peer.name}`}
      onClose={onClose}
      footer={
        status === 'done' ? (
          <button className="btn primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={status !== 'ready' || files.length === 0} onClick={send}>
              {status === 'sending' ? 'Sending…' : `Send${files.length > 1 ? ` (${files.length})` : ''}`}
            </button>
          </>
        )
      }
    >
      {status === 'ready' && <FilePreviewStrip files={files} onRemove={removeFile} />}

      {status === 'ready' && (
        <div className="empty-state" style={{ padding: '10px 0', fontSize: 12 }}>
          {peer.name} will get a prompt to accept — no destination to pick, it just lands wherever they choose to keep it.
        </div>
      )}

      {(status === 'sending' || status === 'done') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {progress.map((p) => (
            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span>{p.name}</span>
              <span style={{ color: p.state === 'error' || p.state === 'declined' || p.state === 'timed-out' ? 'var(--offline)' : 'var(--text-secondary)' }}>
                {p.error ?? statusLabel[p.state]}
              </span>
            </div>
          ))}
        </div>
      )}

      {status === 'ready' && files.length === 0 && (
        <div className="empty-state">No files left to send</div>
      )}
    </Modal>
  );
}
