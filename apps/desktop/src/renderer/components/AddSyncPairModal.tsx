import React, { useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { Modal } from './Modal';

const API_BASE = 'http://localhost:4310';

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};

const SUPPORTS_REAL_FOLDER = new Set(['google-drive']);

const DIRECTION_LABEL: Record<string, string> = {
  'two-way': 'Two-way — changes on either side sync to the other',
  'backup-only': 'Backup only — pushes local changes up, never deletes remotely',
  'download-only': 'Download only — pulls remote changes down, never pushes local edits',
};

// Google-Drive-Desktop-style flow: pick any local folder first, THEN choose which account it syncs to —
// the inverse of the pinned-folder model, where a folder already belongs to one account and local sync is
// bolted on afterward. This is the standalone "Sync" section's entry point (Phase 3/4), not a replacement
// for the existing per-folder Auto-Sync toggle.
export function AddSyncPairModal({
  storage,
  onClose,
  onCreated,
}: {
  storage: ProviderStorage[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [localPath, setLocalPath] = useState('');
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState(storage[0]?.provider ?? '');
  const [direction, setDirection] = useState<'two-way' | 'backup-only' | 'download-only'>('two-way');
  const [createInCloud, setCreateInCloud] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function labelFor(s: ProviderStorage): string {
    return s.label ?? PROVIDER_LABEL[baseProviderOf(s.provider)] ?? s.provider;
  }

  async function pickFolder() {
    const result = await window.alliminate.pickFolder();
    if (result.canceled || !result.path) return;
    setLocalPath(result.path);
    if (!name.trim()) setName(result.path.split('/').pop() ?? '');
  }

  async function create() {
    if (!localPath || !name.trim() || !providerId) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/sync/pairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), localPath, providerId, direction, createInCloud }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't create the sync pair");
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const providerSupportsRealFolder = SUPPORTS_REAL_FOLDER.has(baseProviderOf(providerId || 'x'));

  return (
    <Modal
      title="Add Sync Pair"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!localPath || !name.trim() || !providerId || creating} onClick={create}>
            {creating ? 'Creating…' : 'Start Syncing'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Local folder</label>
          {localPath ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="select-field" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={localPath}>
                {localPath}
              </div>
              <button className="btn small" onClick={pickFolder}>Change</button>
            </div>
          ) : (
            <button className="btn" onClick={pickFolder}>Choose Folder…</button>
          )}
        </div>

        {localPath && (
          <>
            <div>
              <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Name</label>
              <input className="select-field" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Documents Backup" />
            </div>

            <div>
              <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Sync to account</label>
              {storage.length === 0 ? (
                <div className="empty-state">No cloud accounts connected yet</div>
              ) : (
                <select className="select-field" style={{ width: '100%' }} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                  {storage.map((s) => (
                    <option key={s.provider} value={s.provider}>{labelFor(s)}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Direction</label>
              <select className="select-field" style={{ width: '100%' }} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                {(['two-way', 'backup-only', 'download-only'] as const).map((d) => (
                  <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
                ))}
              </select>
            </div>

            {providerSupportsRealFolder && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={createInCloud} onChange={(e) => setCreateInCloud(e.target.checked)} />
                Also create this as a real, visible folder in the cloud (not just in AllieMinate)
              </label>
            )}

            {providerId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                <img src={CLOUD_ICONS[baseProviderOf(providerId)]} alt="" style={{ width: 14, height: 14, objectFit: 'contain' }} />
                Syncs into a new folder in {labelFor(storage.find((s) => s.provider === providerId)!)}
              </div>
            )}
          </>
        )}

        {error && <div style={{ color: 'var(--offline)', fontSize: 11.5 }}>{error}</div>}
      </div>
    </Modal>
  );
}
