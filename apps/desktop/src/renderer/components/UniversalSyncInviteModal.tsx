import React, { useState } from 'react';
import type { UniversalSyncInvite } from '@alliminate/shared';
import { Modal } from './Modal';

const API_BASE = 'http://localhost:4310';

const PERMISSION_LABEL: Record<UniversalSyncInvite['permission'], string> = {
  'read-write': 'Read & Write',
  'read-only': 'Read Only',
  'write-only': 'Write Only',
};

// Shown when a paired device (the "host") has granted this device access to one of its Universal Sync
// Folders — accepting picks/creates a local folder here and creates the ordinary device-target SyncPair
// that keeps it synced (same POST /sync/pairs -> /universal-sync/invites/:id/accept path on the backend).
export function UniversalSyncInviteModal({
  invite,
  onClose,
  onResolved,
}: {
  invite: UniversalSyncInvite;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [parentPath, setParentPath] = useState('');
  const [existingPath, setExistingPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickParent() {
    const result = await window.alliminate.pickFolder();
    if (result.canceled || !result.path) return;
    setParentPath(result.path);
  }

  async function pickExisting() {
    const result = await window.alliminate.pickFolder();
    if (result.canceled || !result.path) return;
    setExistingPath(result.path);
  }

  const localPath = mode === 'new' ? (parentPath ? `${parentPath}/${invite.name}` : '') : existingPath;
  const canAccept = mode === 'new' ? !!parentPath : !!existingPath;

  async function accept() {
    if (!canAccept) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/universal-sync/invites/${invite.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localPath, createNew: mode === 'new' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't accept the invite");
      window.alliminate.openFolder(localPath);
      onResolved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/universal-sync/invites/${invite.id}/decline`, { method: 'POST' });
      onResolved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Universal Sync Invite"
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={decline}>Decline</button>
          <button className="btn primary" disabled={!canAccept || busy} onClick={accept}>
            {busy ? 'Working…' : 'Accept'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13.5 }}>
          <b>{invite.hostDeviceName}</b> wants to share <b>"{invite.name}"</b> with this device —{' '}
          {PERMISSION_LABEL[invite.permission]}.
        </div>

        <div>
          <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Keep it where</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className={`btn small${mode === 'new' ? ' primary' : ''}`} onClick={() => setMode('new')}>New Folder Here</button>
            <button className={`btn small${mode === 'existing' ? ' primary' : ''}`} onClick={() => setMode('existing')}>Use Existing Folder</button>
          </div>

          {mode === 'new' ? (
            parentPath ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="select-field" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${parentPath}/${invite.name}`}>
                  {parentPath}/{invite.name}
                </div>
                <button className="btn small" onClick={pickParent}>Change</button>
              </div>
            ) : (
              <button className="btn" onClick={pickParent}>Choose Where to Create It…</button>
            )
          ) : existingPath ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="select-field" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={existingPath}>
                {existingPath}
              </div>
              <button className="btn small" onClick={pickExisting}>Change</button>
            </div>
          ) : (
            <button className="btn" onClick={pickExisting}>Choose Folder…</button>
          )}
        </div>

        {error && <div style={{ color: 'var(--offline)', fontSize: 11.5 }}>{error}</div>}
      </div>
    </Modal>
  );
}
