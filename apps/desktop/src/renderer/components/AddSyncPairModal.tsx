import React, { useEffect, useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { Modal } from './Modal';
import { IconDevices } from '../icons';

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

interface PeerDevice {
  id: string;
  name: string;
  platform: string;
  online: boolean;
}

interface PeerFolder {
  id: string;
  name: string;
}

interface PeerBrowseFolder {
  name: string;
  path: string;
}

// Google-Drive-Desktop-style flow: pick any local folder first, THEN choose its destination — either a
// cloud account (unchanged) or a paired device's own folder (cloud-backed or a real local folder on that
// device — see localFolders.ts), no cloud account in the loop at all for the latter. This is the
// standalone "Sync" section's entry point, not a replacement for the existing per-folder Auto-Sync toggle.
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
  const [targetKind, setTargetKind] = useState<'cloud' | 'device'>('cloud');
  const [providerId, setProviderId] = useState(storage[0]?.provider ?? '');
  const [direction, setDirection] = useState<'two-way' | 'backup-only' | 'download-only'>('two-way');
  const [createInCloud, setCreateInCloud] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [devices, setDevices] = useState<PeerDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [remoteFolderKind, setRemoteFolderKind] = useState<'folder' | 'local-folder'>('local-folder');
  const [peerFolders, setPeerFolders] = useState<PeerFolder[]>([]);
  const [peerFoldersLoading, setPeerFoldersLoading] = useState(false);
  const [remoteFolderId, setRemoteFolderId] = useState('');
  // Tree-browse state — only used when remoteFolderKind === 'local-folder', where the peer's /files route
  // understands ?path= drill-down (cloud "folder" targets stay a flat namespace, no nested-path concept).
  const [remoteSubPath, setRemoteSubPath] = useState('');
  const [browseFolders, setBrowseFolders] = useState<PeerBrowseFolder[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    if (targetKind !== 'device') return;
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((data) => {
        const online: PeerDevice[] = (data.paired ?? []).filter((d: PeerDevice) => d.online);
        setDevices(online);
        if (online.length > 0 && !deviceId) setDeviceId(online[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKind]);

  useEffect(() => {
    if (targetKind !== 'device' || !deviceId) return;
    setPeerFoldersLoading(true);
    setRemoteFolderId('');
    setRemoteSubPath('');
    const segment = remoteFolderKind === 'local-folder' ? 'local-folders' : 'folders';
    fetch(`${API_BASE}/devices/${deviceId}/${segment}`)
      .then((res) => res.json())
      .then((data) => {
        const list: PeerFolder[] = data.folders ?? [];
        setPeerFolders(list);
        if (list.length > 0) setRemoteFolderId(list[0].id);
      })
      .catch(() => setPeerFolders([]))
      .finally(() => setPeerFoldersLoading(false));
  }, [targetKind, deviceId, remoteFolderKind]);

  // Drill-down listing for the current shortcut + subpath — local-folder targets only (see PeerBrowseFolder).
  useEffect(() => {
    if (targetKind !== 'device' || remoteFolderKind !== 'local-folder' || !deviceId || !remoteFolderId) {
      setBrowseFolders([]);
      return;
    }
    setBrowseLoading(true);
    setBrowseError(null);
    const qs = remoteSubPath ? `?path=${encodeURIComponent(remoteSubPath)}` : '';
    fetch(`${API_BASE}/devices/${deviceId}/local-folders/${remoteFolderId}/files${qs}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setBrowseFolders(data.folders ?? []);
      })
      .catch((err) => {
        setBrowseFolders([]);
        setBrowseError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBrowseLoading(false));
  }, [targetKind, remoteFolderKind, deviceId, remoteFolderId, remoteSubPath]);

  async function createRemoteFolder() {
    if (!newFolderName.trim() || !deviceId || !remoteFolderId) return;
    setCreatingFolder(true);
    setBrowseError(null);
    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/local-folders/${remoteFolderId}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: remoteSubPath || undefined, name: newFolderName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't create that folder");
      setNewFolderName('');
      setNewFolderOpen(false);
      setBrowseFolders((prev) =>
        [...prev, { name: newFolderName.trim(), path: data.path }].sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingFolder(false);
    }
  }

  function labelFor(s: ProviderStorage): string {
    return s.label ?? PROVIDER_LABEL[baseProviderOf(s.provider)] ?? s.provider;
  }

  async function pickFolder() {
    const result = await window.alliminate.pickFolder();
    if (result.canceled || !result.path) return;
    setLocalPath(result.path);
    if (!name.trim()) setName(result.path.split('/').pop() ?? '');
  }

  const canCreate =
    !!localPath &&
    !!name.trim() &&
    (targetKind === 'cloud' ? !!providerId : !!deviceId && !!remoteFolderId);

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const body =
        targetKind === 'cloud'
          ? { name: name.trim(), localPath, providerId, direction, createInCloud }
          : { name: name.trim(), localPath, deviceId, remoteFolderId, remoteFolderKind, remoteSubPath, direction };
      const res = await fetch(`${API_BASE}/sync/pairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          <button className="btn primary" disabled={!canCreate || creating} onClick={create}>
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
              <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Sync against</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn small${targetKind === 'cloud' ? ' primary' : ''}`} onClick={() => setTargetKind('cloud')}>
                  Cloud Account
                </button>
                <button className={`btn small${targetKind === 'device' ? ' primary' : ''}`} onClick={() => setTargetKind('device')}>
                  Paired Device
                </button>
              </div>
            </div>

            {targetKind === 'cloud' ? (
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
            ) : (
              <>
                <div>
                  <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Device</label>
                  {devices.length === 0 ? (
                    <div className="empty-state"><IconDevices size={20} /><div style={{ marginTop: 6 }}>No paired devices online right now</div></div>
                  ) : (
                    <select className="select-field" style={{ width: '100%' }} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {deviceId && (
                  <>
                    <div>
                      <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Folder type on that device</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className={`btn small${remoteFolderKind === 'local-folder' ? ' primary' : ''}`} onClick={() => setRemoteFolderKind('local-folder')}>
                          Local Folder
                        </button>
                        <button className={`btn small${remoteFolderKind === 'folder' ? ' primary' : ''}`} onClick={() => setRemoteFolderKind('folder')}>
                          Cloud Folder
                        </button>
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>
                        {remoteFolderKind === 'local-folder' ? 'Starting folder' : 'Folder'}
                      </label>
                      {peerFoldersLoading ? (
                        <div className="empty-state">Loading…</div>
                      ) : peerFolders.length === 0 ? (
                        <div className="empty-state">Nothing to sync against on that device yet</div>
                      ) : (
                        <select
                          className="select-field"
                          style={{ width: '100%' }}
                          value={remoteFolderId}
                          onChange={(e) => {
                            setRemoteFolderId(e.target.value);
                            setRemoteSubPath('');
                          }}
                        >
                          {peerFolders.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {remoteFolderKind === 'local-folder' && remoteFolderId && (
                      <div>
                        <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Destination</label>
                        {/* Breadcrumb: shortcut root + each drilled-into subpath segment, all clickable. */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 12, marginBottom: 6 }}>
                          <button
                            className="btn small"
                            style={{ padding: '2px 8px' }}
                            disabled={!remoteSubPath}
                            onClick={() => setRemoteSubPath('')}
                          >
                            {peerFolders.find((f) => f.id === remoteFolderId)?.name ?? 'Root'}
                          </button>
                          {remoteSubPath &&
                            remoteSubPath.split('/').map((segment, i, segments) => {
                              const crumbPath = segments.slice(0, i + 1).join('/');
                              const isLast = i === segments.length - 1;
                              return (
                                <React.Fragment key={crumbPath}>
                                  <span style={{ color: 'var(--text-tertiary)' }}>/</span>
                                  <button
                                    className="btn small"
                                    style={{ padding: '2px 8px' }}
                                    disabled={isLast}
                                    onClick={() => setRemoteSubPath(crumbPath)}
                                  >
                                    {segment}
                                  </button>
                                </React.Fragment>
                              );
                            })}
                        </div>

                        <div
                          className="select-field"
                          style={{ width: '100%', maxHeight: 180, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}
                        >
                          {browseLoading ? (
                            <div className="empty-state">Loading…</div>
                          ) : browseError ? (
                            <div style={{ color: 'var(--offline)', fontSize: 11.5, padding: 4 }}>{browseError}</div>
                          ) : browseFolders.length === 0 && !newFolderOpen ? (
                            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: 4 }}>No subfolders here — syncing into this folder</div>
                          ) : (
                            browseFolders.map((f) => (
                              <button
                                key={f.path}
                                className="btn small"
                                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                                onClick={() => setRemoteSubPath(f.path)}
                              >
                                📁 {f.name}
                              </button>
                            ))
                          )}

                          {newFolderOpen ? (
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <input
                                className="select-field"
                                style={{ flex: 1 }}
                                autoFocus
                                placeholder="New folder name"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') createRemoteFolder();
                                  if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName(''); }
                                }}
                              />
                              <button className="btn small primary" disabled={!newFolderName.trim() || creatingFolder} onClick={createRemoteFolder}>
                                {creatingFolder ? 'Creating…' : 'Create'}
                              </button>
                              <button className="btn small" onClick={() => { setNewFolderOpen(false); setNewFolderName(''); }}>Cancel</button>
                            </div>
                          ) : (
                            <button className="btn small" style={{ marginTop: 4, alignSelf: 'flex-start' }} onClick={() => setNewFolderOpen(true)}>
                              + New Folder
                            </button>
                          )}
                        </div>

                        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 6 }}>
                          Syncs into {peerFolders.find((f) => f.id === remoteFolderId)?.name}
                          {remoteSubPath ? ` / ${remoteSubPath.split('/').join(' / ')}` : ''}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            <div>
              <label style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Direction</label>
              <select className="select-field" style={{ width: '100%' }} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                {(['two-way', 'backup-only', 'download-only'] as const).map((d) => (
                  <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
                ))}
              </select>
            </div>

            {targetKind === 'cloud' && providerSupportsRealFolder && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={createInCloud} onChange={(e) => setCreateInCloud(e.target.checked)} />
                Also create this as a real, visible folder in the cloud (not just in AllieMinate)
              </label>
            )}

            {targetKind === 'cloud' && providerId && (
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
