import React, { useEffect, useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { Modal } from './Modal';
import { IconMac, IconWindows, IconPhone, IconDevices } from '../icons';

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

type Permission = 'read-write' | 'read-only' | 'write-only';

const PERMISSION_LABEL: Record<Permission, string> = {
  'read-write': 'Read & Write',
  'read-only': 'Read Only',
  'write-only': 'Write Only',
};

interface PeerDevice {
  id: string;
  name: string;
  platform: string;
  online: boolean;
}

function platformIcon(platform: string, size: number) {
  if (platform === 'darwin') return <IconMac size={size} />;
  if (platform === 'win32') return <IconWindows size={size} />;
  if (platform === 'android' || platform === 'ios') return <IconPhone size={size} />;
  return <IconDevices size={size} />;
}

// "Create a Universal Sync" — this device becomes the host (holds the real cloud login for the chosen
// account); every granted device gets its own SyncPair pointed back at this one over the LAN (the same
// "Paired Device" mechanism AddSyncPairModal already offers, just created FOR them instead of by them),
// with direction derived from the permission assigned here. See universalSync.ts on the backend for the
// invite delivery this triggers.
export function CreateUniversalSyncModal({
  storage,
  onClose,
  onCreated,
}: {
  storage: ProviderStorage[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [newFolderName, setNewFolderName] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [existingPath, setExistingPath] = useState('');
  const [providerId, setProviderId] = useState(storage[0]?.provider ?? '');
  const [createInCloud, setCreateInCloud] = useState(false);
  const [devices, setDevices] = useState<PeerDevice[]>([]);
  const [grants, setGrants] = useState<Record<string, Permission>>({}); // deviceId -> permission, presence = selected
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((data) => setDevices((data.paired ?? []).filter((d: PeerDevice) => d.online)))
      .catch(() => {});
  }, []);

  function labelFor(s: ProviderStorage): string {
    return s.label ?? PROVIDER_LABEL[baseProviderOf(s.provider)] ?? s.provider;
  }

  async function pickParent() {
    const result = await window.alliminate.pickFolder();
    if (result.canceled || !result.path) return;
    setParentPath(result.path);
  }

  async function pickExisting() {
    const result = await window.alliminate.pickFolder();
    if (result.canceled || !result.path) return;
    setExistingPath(result.path);
    if (!newFolderName.trim()) setNewFolderName(result.path.split('/').pop() ?? '');
  }

  function toggleDevice(id: string) {
    setGrants((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 'read-write';
      return next;
    });
  }

  function setPermission(id: string, permission: Permission) {
    setGrants((prev) => ({ ...prev, [id]: permission }));
  }

  const localPath = mode === 'new' ? (parentPath ? `${parentPath}/${newFolderName.trim()}` : '') : existingPath;
  const canCreate =
    !!newFolderName.trim() &&
    (mode === 'new' ? !!parentPath : !!existingPath) &&
    !!providerId &&
    Object.keys(grants).length > 0;

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const pairRes = await fetch(`${API_BASE}/sync/pairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          localPath,
          providerId,
          direction: 'two-way',
          createInCloud,
          createNew: mode === 'new',
        }),
      });
      const pairData = await pairRes.json().catch(() => ({}));
      if (!pairRes.ok) throw new Error(pairData.error ?? "Couldn't create the folder");

      const inviteRes = await fetch(`${API_BASE}/universal-sync/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostFolderId: pairData.pair.id,
          name: newFolderName.trim(),
          grants: Object.entries(grants).map(([deviceId, permission]) => ({ deviceId, permission })),
        }),
      });
      const inviteData = await inviteRes.json().catch(() => ({}));
      if (!inviteRes.ok) throw new Error(inviteData.error ?? "Couldn't invite the selected devices");

      window.alliminate.openFolder(localPath);
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
      title="Create a Universal Sync"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canCreate || creating} onClick={create}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Folder</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className={`btn small${mode === 'new' ? ' primary' : ''}`} onClick={() => setMode('new')}>New Folder</button>
            <button className={`btn small${mode === 'existing' ? ' primary' : ''}`} onClick={() => setMode('existing')}>Existing Folder</button>
          </div>

          {mode === 'new' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="select-field"
                style={{ width: '100%' }}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name, e.g. Family Photos"
              />
              {parentPath ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="select-field" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={parentPath}>
                    {parentPath}
                  </div>
                  <button className="btn small" onClick={pickParent}>Change</button>
                </div>
              ) : (
                <button className="btn" onClick={pickParent}>Choose Where to Create It…</button>
              )}
            </div>
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

        <div>
          <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Cloud service to sync through</label>
          {storage.length === 0 ? (
            <div className="empty-state">No cloud accounts connected yet</div>
          ) : (
            <select className="select-field" style={{ width: '100%' }} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {storage.map((s) => (
                <option key={s.provider} value={s.provider}>{labelFor(s)}</option>
              ))}
            </select>
          )}
          {providerId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 6 }}>
              <img src={CLOUD_ICONS[baseProviderOf(providerId)]} alt="" style={{ width: 14, height: 14, objectFit: 'contain' }} />
              Held only by this device — granted devices sync through this Mac, not their own login
            </div>
          )}
        </div>

        {providerSupportsRealFolder && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={createInCloud} onChange={(e) => setCreateInCloud(e.target.checked)} />
            Also create this as a real, visible folder in the cloud
          </label>
        )}

        <div>
          <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Give access to</label>
          {devices.length === 0 ? (
            <div className="empty-state"><IconDevices size={20} /><div style={{ marginTop: 6 }}>No paired devices online right now</div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {devices.map((d) => {
                const selected = d.id in grants;
                return (
                  <div
                    key={d.id}
                    className="glass-card"
                    style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', outline: selected ? '2px solid var(--accent)' : 'none' }}
                  >
                    <div onClick={() => toggleDevice(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <input type="checkbox" checked={selected} onChange={() => toggleDevice(d.id)} onClick={(e) => e.stopPropagation()} />
                      {platformIcon(d.platform, 18)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    </div>
                    {selected && (
                      <select
                        className="select-field"
                        style={{ fontSize: 12 }}
                        value={grants[d.id]}
                        onChange={(e) => setPermission(d.id, e.target.value as Permission)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {(['read-write', 'read-only', 'write-only'] as const).map((p) => (
                          <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && <div style={{ color: 'var(--offline)', fontSize: 11.5 }}>{error}</div>}
      </div>
    </Modal>
  );
}
