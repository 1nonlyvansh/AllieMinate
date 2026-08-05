import React, { useEffect, useState } from 'react';
import type { TrashEntry } from '../lib/types';
import { formatBytes, timeAgo, broadCategorize } from '../lib/format';
import { IconTrash, IconImage, IconVideo, IconAudio, IconDocument, IconArchive, IconFiles } from '../icons';
import { DropdownMenu } from '../components/DropdownMenu';
import { Modal } from '../components/Modal';

const API_BASE = 'http://localhost:4310';
const MAX_AGE_DAYS = 30;

function categoryIcon(category: string, size: number) {
  if (category === 'image') return <IconImage size={size} />;
  if (category === 'video') return <IconVideo size={size} />;
  if (category === 'audio') return <IconAudio size={size} />;
  if (category === 'document') return <IconDocument size={size} />;
  if (category === 'archive') return <IconArchive size={size} />;
  return <IconFiles size={size} />;
}

// Small thumbnail for grid cards — fetches bytes once and caches a blob: URL, image types only.
function TrashThumb({ entry, size }: { entry: TrashEntry; size: number }) {
  const category = broadCategorize(entry.name);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (category !== 'image') return;
    let cancelled = false;
    let url: string | null = null;
    fetch(`${API_BASE}/trash/${entry.id}/download`)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry.id, category]);

  if (category === 'image' && blobUrl) {
    return (
      <img
        src={blobUrl}
        alt=""
        style={{ width: '100%', height: 48, objectFit: 'cover', borderRadius: 8 }}
      />
    );
  }
  return categoryIcon(category, size);
}

// Trash items are on their way out — inline preview only, never handed to an external app.
function TrashPreviewModal({ entry, onClose }: { entry: TrashEntry; onClose: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<string>('application/octet-stream');
  const category = broadCategorize(entry.name);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setStatus('loading');
    fetch(`${API_BASE}/trash/${entry.id}/download`)
      .then((res) => {
        if (!res.ok) throw new Error('download failed');
        setMime(res.headers.get('content-type') || 'application/octet-stream');
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
  }, [entry.id]);

  return (
    <Modal
      title={entry.name}
      onClose={onClose}
      size={category === 'image' || category === 'video' ? 'lg' : undefined}
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      <div className={`preview-area${category === 'image' || category === 'video' ? ' preview-area-lg' : ''}`}>
        {status === 'loading' && <div className="empty-state">Loading preview…</div>}
        {status === 'error' && <div className="empty-state">Couldn't load preview</div>}
        {status === 'ready' && blobUrl && category === 'image' && (
          <img src={blobUrl} style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 8, display: 'block', margin: '0 auto' }} />
        )}
        {status === 'ready' && blobUrl && category === 'video' && (
          <video src={blobUrl} controls style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 8, display: 'block', margin: '0 auto' }} />
        )}
        {status === 'ready' && blobUrl && category === 'audio' && (
          <audio src={blobUrl} controls style={{ width: '100%' }} />
        )}
        {status === 'ready' && blobUrl && category !== 'image' && category !== 'video' && category !== 'audio' && mime === 'application/pdf' && (
          <embed src={`${blobUrl}#toolbar=1&view=FitH`} type="application/pdf" style={{ width: '100%', height: '65vh', border: 'none', borderRadius: 8 }} />
        )}
        {status === 'ready' && (category === 'document' || category === 'archive' || category === 'other') && mime !== 'application/pdf' && (
          <div className="empty-state">
            {categoryIcon(category, 30)}
            <div style={{ marginTop: 10 }}>No inline preview for this file type — restore it to open elsewhere.</div>
          </div>
        )}
      </div>
      <table className="prop-table">
        <tbody>
          <tr><td>Name</td><td>{entry.name}</td></tr>
          <tr><td>Size</td><td>{formatBytes(entry.size)}</td></tr>
          <tr><td>Cloud provider</td><td>{entry.provider}</td></tr>
          <tr><td>Deleted</td><td>{new Date(entry.deletedAt).toLocaleString()}</td></tr>
        </tbody>
      </table>
    </Modal>
  );
}

export function TrashView() {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<TrashEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/trash`);
      const data: { entries: TrashEntry[] } = await res.json();
      setEntries(data.entries);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function restore(id: string) {
    setBusy(id);
    await fetch(`${API_BASE}/trash/${id}/restore`, { method: 'POST' });
    await refresh();
    setBusy(null);
  }

  async function deleteForever(id: string, name: string) {
    if (!window.confirm(`Permanently delete "${name}"? This can't be undone.`)) return;
    setBusy(id);
    await fetch(`${API_BASE}/trash/${id}`, { method: 'DELETE' });
    await refresh();
    setBusy(null);
  }

  async function emptyTrash() {
    if (!window.confirm(`Permanently delete all ${entries.length} item(s) in Trash? This can't be undone.`)) return;
    setBusy('*');
    await fetch(`${API_BASE}/trash/empty`, { method: 'POST' });
    await refresh();
    setBusy(null);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function restoreSelected() {
    setBusy('*');
    await Promise.all(Array.from(selected).map((id) => fetch(`${API_BASE}/trash/${id}/restore`, { method: 'POST' })));
    setSelected(new Set());
    await refresh();
    setBusy(null);
  }

  async function deleteSelected() {
    if (!window.confirm(`Permanently delete ${selected.size} item(s)? This can't be undone.`)) return;
    setBusy('*');
    await Promise.all(Array.from(selected).map((id) => fetch(`${API_BASE}/trash/${id}`, { method: 'DELETE' })));
    setSelected(new Set());
    await refresh();
    setBusy(null);
  }

  function daysLeft(deletedAt: string): number {
    const elapsedMs = Date.now() - new Date(deletedAt).getTime();
    return Math.max(0, MAX_AGE_DAYS - Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>Trash</h1>
          <p>Deleted files are kept for {MAX_AGE_DAYS} days before permanent removal</p>
        </div>
        {selected.size > 0 ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-tertiary)' }}>{selected.size} selected</span>
            <button className="btn small" disabled={busy !== null} onClick={() => setSelected(new Set())}>Clear</button>
            <button className="btn small" disabled={busy !== null} onClick={restoreSelected}>Restore</button>
            <button className="btn small danger-outline" disabled={busy !== null} onClick={deleteSelected}>Delete Forever</button>
          </div>
        ) : (
          entries.length > 0 && (
            <button className="btn danger-outline" disabled={busy !== null} onClick={emptyTrash}>
              {busy === '*' ? 'Emptying…' : 'Empty Trash'}
            </button>
          )
        )}
      </div>

      {loading && <div className="glass-card empty-state">Loading…</div>}

      {!loading && entries.length === 0 && (
        <div className="glass-card empty-state">
          <IconTrash size={26} />
          <div style={{ marginTop: 10 }}>Nothing in Trash</div>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div className="folder-grid">
          {entries.map((e) => (
            <div key={e.id} className="folder-card glass-card" style={{ position: 'relative' }}>
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => toggleSelect(e.id)}
                onClick={(ev) => ev.stopPropagation()}
                style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, cursor: 'pointer' }}
              />
              <div style={{ position: 'absolute', top: 6, right: 6 }}>
                <DropdownMenu
                  items={[
                    { label: 'Preview', onClick: () => setPreviewing(e) },
                    { label: 'Restore', onClick: () => restore(e.id) },
                    { divider: true },
                    { label: 'Delete Forever', danger: true, onClick: () => deleteForever(e.id, e.name) },
                  ]}
                />
              </div>
              <div
                className="folder-icon"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                onClick={() => setPreviewing(e)}
              >
                <TrashThumb entry={e} size={30} />
              </div>
              <div className="folder-name" title={e.name} onClick={() => setPreviewing(e)} style={{ cursor: 'pointer' }}>
                {e.name}
              </div>
              <div className="folder-meta">{formatBytes(e.size)} · {e.provider}</div>
              <div className="folder-meta">deleted {timeAgo(e.deletedAt)} · {daysLeft(e.deletedAt)}d left</div>
            </div>
          ))}
        </div>
      )}

      {previewing && <TrashPreviewModal entry={previewing} onClose={() => setPreviewing(null)} />}
    </section>
  );
}
