import React, { useEffect, useState } from 'react';
import type { ProviderStorage, UniversalSyncInvite } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import type { ActivityEntry, SyncPair, PairedDeviceInfo } from '../lib/types';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { formatBytes, timeAgo } from '../lib/format';
import { AddSyncPairModal } from '../components/AddSyncPairModal';
import { CreateUniversalSyncModal } from '../components/CreateUniversalSyncModal';
import { UniversalSyncInviteModal } from '../components/UniversalSyncInviteModal';
import { SyncPairFileBrowser } from '../components/SyncPairFileBrowser';
import { Modal } from '../components/Modal';
import { DropdownMenu } from '../components/DropdownMenu';
import { NearbyPickerModal } from '../components/NearbyPickerModal';
import { SendableFile } from '../lib/sendActions';
import { IconSync, IconAdd, IconTrash, IconPhone, IconChevronLeft, IconFiles, IconDevices } from '../icons';
import { deviceNounLower, fileBrowserName } from '../lib/platformLabels';

const INVITE_POLL_MS = 15000;

const API_BASE = 'http://localhost:4310';

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};

const DIRECTION_SHORT: Record<string, string> = {
  'two-way': 'Two-way',
  'backup-only': 'Backup only',
  'download-only': 'Download only',
};

interface PairWithStatus extends SyncPair {
  paused: boolean;
  fileCounts: { synced: number; error: number; total: number };
  progress: { done: number; total: number; active: boolean; startedAt: string } | null;
}

// the phone's own half of the Sync Engine — a Sync Pair it manages locally, browsed here read-only
// (Phase 4 scope: view + fetch what's already there, not manage the pair itself from the Mac side).
interface RemoteSyncPair {
  id: string;
  name: string;
  providerLabel: string;
  remoteFolderName: string;
  status: string;
}
interface RemoteSyncFile {
  path: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

function syncFileCategory(name: string, mimeType?: string): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext) || mimeType?.startsWith('image/')) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext) || mimeType?.startsWith('video/')) return 'video';
  if (['mp3', 'wav', 'aac', 'm4a'].includes(ext) || mimeType?.startsWith('audio/')) return 'audio';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  return 'other';
}

function SyncFromDevicePreviewModal({ deviceId, pairId, file, onClose }: { deviceId: string; pairId: string; file: RemoteSyncFile; onClose: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const category = syncFileCategory(file.path, file.mimeType);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setStatus('loading');
    fetch(`${API_BASE}/devices/${deviceId}/sync-pairs/${pairId}/download?key=${encodeURIComponent(file.path)}`)
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
  }, [deviceId, pairId, file.path]);

  const big = category === 'image' || category === 'video';

  return (
    <Modal title={file.path} onClose={onClose} size={big ? 'lg' : undefined} footer={<button className="btn" onClick={onClose}>Close</button>}>
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
        {status === 'ready' && blobUrl && category === 'pdf' && (
          <embed src={`${blobUrl}#toolbar=1&view=FitH`} type="application/pdf" style={{ width: '100%', height: '65vh', border: 'none', borderRadius: 8 }} />
        )}
        {status === 'ready' && category === 'other' && (
          <div className="empty-state">
            <IconFiles size={30} />
            <div style={{ marginTop: 10 }}>No inline preview for this file type.</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SyncFromDeviceBrowser({ device, onBack }: { device: PairedDeviceInfo; onBack: () => void }) {
  const [pairs, setPairs] = useState<RemoteSyncPair[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePair, setActivePair] = useState<RemoteSyncPair | null>(null);
  const [files, setFiles] = useState<RemoteSyncFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<RemoteSyncFile | null>(null);
  const [detailsFile, setDetailsFile] = useState<RemoteSyncFile | null>(null);
  const [nearbyTarget, setNearbyTarget] = useState<{ file: SendableFile; name: string } | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/devices/${device.id}/sync-pairs`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const list: RemoteSyncPair[] = (data.pairs ?? []).filter((p: RemoteSyncPair) => p.status === 'active');
        setPairs(list);
        if (list.length > 0) openPair(list[0]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id]);

  function openPair(pair: RemoteSyncPair) {
    setActivePair(pair);
    setFilesLoading(true);
    setFilesError(null);
    fetch(`${API_BASE}/devices/${device.id}/sync-pairs/${pair.id}/files`)
      .then((res) => res.json())
      .then((data) => {
        setFiles(data.files ?? []);
        setFilesError(data.error ?? null);
      })
      .catch((err) => setFilesError(err instanceof Error ? err.message : String(err)))
      .finally(() => setFilesLoading(false));
  }

  async function downloadFile(f: RemoteSyncFile) {
    if (!activePair) return;
    const res = await fetch(`${API_BASE}/devices/${device.id}/sync-pairs/${activePair.id}/download?key=${encodeURIComponent(f.path)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.path;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openInApp(f: RemoteSyncFile) {
    if (!activePair) return;
    await fetch(`${API_BASE}/devices/${device.id}/sync-pairs/${activePair.id}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: f.path, mimeType: f.mimeType }),
    });
  }

  async function cachePath(f: RemoteSyncFile): Promise<string | null> {
    if (!activePair) return null;
    try {
      const res = await fetch(`${API_BASE}/devices/${device.id}/sync-pairs/${activePair.id}/cache-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: f.path, mimeType: f.mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed');
      return data.path;
    } catch (err) {
      window.alert("Couldn't reach this file — " + (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  async function copyToClipboard(f: RemoteSyncFile) {
    const path = await cachePath(f);
    if (!path) return;
    const result = await window.alliminate.copyLocalFile(path);
    if (!result.ok) window.alert("Couldn't copy this file — " + result.error);
  }

  async function shareNearby(f: RemoteSyncFile) {
    // Nearby Share sends bytes straight from a local path — a file living on the SOURCE phone has to be
    // pulled onto this Mac first (same cache the Copy to Clipboard action already uses) before it can be
    // relayed onward to a third, nearby device.
    const path = await cachePath(f);
    if (!path) return;
    setNearbyTarget({ file: { kind: 'local', path, mimeType: f.mimeType }, name: f.path });
  }

  function menuItemsFor(f: RemoteSyncFile) {
    return [
      { label: 'Preview', onClick: () => setPreviewFile(f) },
      { label: 'Open in App', onClick: () => openInApp(f) },
      { label: 'Download', onClick: () => downloadFile(f) },
      { label: 'Copy to Clipboard', onClick: () => copyToClipboard(f) },
      { label: 'Share to Nearby', onClick: () => shareNearby(f) },
      { divider: true },
      { label: 'Details', onClick: () => setDetailsFile(f) },
    ];
  }

  return (
    <div className="glass-card" style={{ padding: 14 }}>
      <button className="btn small" onClick={onBack} style={{ marginBottom: 12 }}>
        <IconChevronLeft size={12} /> Back to Devices
      </button>

      {error && <div className="empty-state" style={{ color: 'var(--offline)' }}>{error}</div>}

      {!error && (
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', minHeight: 300 }}>
          <div
            style={{
              width: 176, flexShrink: 0, padding: '4px 10px 4px 0', display: 'flex', flexDirection: 'column', gap: 2,
              borderRight: '1px solid var(--hairline)', marginRight: 20,
            }}
          >
            {(pairs ?? []).map((p) => (
              <div
                key={p.id}
                onClick={() => openPair(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, fontWeight: activePair?.id === p.id ? 600 : 400,
                  background: activePair?.id === p.id ? 'var(--accent-soft)' : 'transparent',
                  color: activePair?.id === p.id ? 'var(--accent-text)' : 'inherit',
                }}
              >
                <IconSync size={15} />
                {p.name}
              </div>
            ))}
            {pairs === null && <div className="empty-state" style={{ fontSize: 12 }}>Loading…</div>}
            {pairs !== null && pairs.length === 0 && <div className="empty-state" style={{ fontSize: 12 }}>No active Sync Pairs on this device</div>}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="folder-grid" style={{ alignContent: 'start', alignItems: 'start' }}>
              {filesLoading && <div className="empty-state">Loading…</div>}
              {!filesLoading && files.length === 0 && (
                <div className="empty-state" style={filesError ? { color: 'var(--offline)' } : undefined}>
                  {filesError ?? 'Nothing here yet'}
                </div>
              )}
              {!filesLoading && files.map((f) => {
                const category = syncFileCategory(f.path, f.mimeType);
                return (
                  <div key={f.path} className="folder-card glass-card" style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setPreviewFile(f)}>
                    <div style={{ position: 'absolute', top: 6, right: 6 }} onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu items={menuItemsFor(f)} />
                    </div>
                    <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48 }}>
                      {category === 'image' ? (
                        <img
                          src={`${API_BASE}/devices/${device.id}/sync-pairs/${activePair?.id}/download?key=${encodeURIComponent(f.path)}`}
                          alt=""
                          style={{ width: '100%', height: 48, objectFit: 'cover', borderRadius: 6 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <IconFiles size={30} />
                      )}
                    </div>
                    <div className="folder-name" title={f.path}>{f.path}</div>
                    <div className="folder-meta">{formatBytes(f.size)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {previewFile && activePair && (
        <SyncFromDevicePreviewModal deviceId={device.id} pairId={activePair.id} file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      {detailsFile && (
        <Modal title="Details" onClose={() => setDetailsFile(null)} footer={<button className="btn" onClick={() => setDetailsFile(null)}>Close</button>}>
          <table className="prop-table">
            <tbody>
              <tr><td>Name</td><td>{detailsFile.path}</td></tr>
              <tr><td>Size</td><td>{formatBytes(detailsFile.size)}</td></tr>
              <tr><td>Modified</td><td>{new Date(detailsFile.modifiedAt).toLocaleString()}</td></tr>
              <tr><td>Synced from</td><td>{device.name}{activePair ? ` — ${activePair.name}` : ''}</td></tr>
            </tbody>
          </table>
        </Modal>
      )}
      {nearbyTarget && (
        <NearbyPickerModal file={nearbyTarget.file} fileName={nearbyTarget.name} onClose={() => setNearbyTarget(null)} />
      )}
    </div>
  );
}

function SyncFromDeviceSection() {
  const [devices, setDevices] = useState<PairedDeviceInfo[]>([]);
  const [browsing, setBrowsing] = useState<PairedDeviceInfo | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((data) => setDevices((data.paired ?? []).filter((d: PairedDeviceInfo) => d.platform === 'android')))
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="section-title">Sync from Device</div>
      {browsing ? (
        <div style={{ marginBottom: 24 }}>
          <SyncFromDeviceBrowser device={browsing} onBack={() => setBrowsing(null)} />
        </div>
      ) : devices.length === 0 ? (
        <div className="empty-state glass-card" style={{ padding: '24px 0', marginBottom: 24 }}>
          No paired Android phones with the Sync Engine set up yet.
        </div>
      ) : (
        <div className="device-strip" style={{ marginBottom: 24 }}>
          {devices.map((d) => (
            <div
              key={d.id}
              className="device-card glass-card"
              style={{ cursor: d.online ? 'pointer' : 'default', opacity: d.online ? 1 : 0.6 }}
              onClick={() => d.online && setBrowsing(d)}
            >
              <div className="device-icon"><IconPhone size={34} /></div>
              <div className="device-name">{d.name}</div>
              <div className="device-meta">{d.platform}</div>
              <div className={`status-pill ${d.online ? 'online' : 'offline'}`}>
                <span className={`status-dot ${d.online ? 'online' : 'offline'}`} /> {d.online ? 'Online' : 'Offline'}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function SyncView({
  storage,
  activity,
}: {
  storage: ProviderStorage[];
  activity: ActivityEntry[];
}) {
  const [pairs, setPairs] = useState<PairWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showUniversalSync, setShowUniversalSync] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<UniversalSyncInvite[]>([]);
  const [respondingInvite, setRespondingInvite] = useState<UniversalSyncInvite | null>(null);
  const [browsingPair, setBrowsingPair] = useState<PairWithStatus | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});

  // covers invites that arrived while this device was offline/closed — a live push while the app is open
  // would be nicer, but a Universal Sync invite (unlike an ephemeral nearby-transfer offer) doesn't expire
  // in seconds, so polling on a plain interval whenever the Sync tab is open is a fine trade for not
  // threading a new global WS event type through App.tsx just for this.
  useEffect(() => {
    function loadInvites() {
      fetch(`${API_BASE}/universal-sync/invites`)
        .then((res) => res.json())
        .then((data) => setPendingInvites(data.invites ?? []))
        .catch(() => {});
    }
    loadInvites();
    const interval = setInterval(loadInvites, INVITE_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  async function refresh() {
    try {
      const res = await fetch(`${API_BASE}/sync/pairs`);
      const data = await res.json();
      setPairs(data.pairs ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((data) => {
        const names: Record<string, string> = {};
        for (const d of data.paired ?? []) names[d.id] = d.name;
        setDeviceNames(names);
      })
      .catch(() => {});
  }, []);

  async function loadRules() {
    const res = await fetch(`${API_BASE}/sync/ignore-rules`);
    const data = await res.json();
    setRules(data.rules ?? []);
  }

  useEffect(() => {
    refresh();
    loadRules();
  }, []);

  // polls faster while anything is actively syncing so the progress bar actually feels live, and backs
  // off to a slow poll the rest of the time — no reason to hit the backend every 2s when nothing's moving.
  const anyActive = pairs.some((p) => p.progress?.active);
  useEffect(() => {
    const interval = setInterval(refresh, anyActive ? 2_000 : 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyActive]);

  function labelFor(providerId?: string): string {
    if (!providerId) return 'Unknown';
    const s = storage.find((x) => x.provider === providerId);
    return s?.label ?? PROVIDER_LABEL[baseProviderOf(providerId)] ?? providerId;
  }

  async function pause(id: string) {
    await fetch(`${API_BASE}/sync/pairs/${id}/pause`, { method: 'POST' });
    refresh();
  }

  async function resume(id: string) {
    await fetch(`${API_BASE}/sync/pairs/${id}/resume`, { method: 'POST' });
    refresh();
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Stop syncing "${name}"? Local files and anything already synced stay untouched.`)) return;
    await fetch(`${API_BASE}/sync/pairs/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function saveRules(next: string[]) {
    setSavingRules(true);
    try {
      await fetch(`${API_BASE}/sync/ignore-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: next }),
      });
      setRules(next);
    } finally {
      setSavingRules(false);
    }
  }

  function addRule() {
    const trimmed = newRule.trim();
    if (!trimmed || rules.includes(trimmed)) return;
    setNewRule('');
    saveRules([...rules, trimmed]);
  }

  function removeRule(rule: string) {
    saveRules(rules.filter((r) => r !== rule));
  }

  const pairIds = new Set(pairs.map((p) => p.id));
  const scopedActivity = activity.filter((a) => a.folderId && pairIds.has(a.folderId));

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>Sync</h1>
          <div className="subtitle">Sync any folder on {deviceNounLower} to a cloud account, in the background</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowUniversalSync(true)}>
            <IconAdd size={14} /> Create a Universal Sync
          </button>
          <button className="btn primary" onClick={() => setShowAdd(true)}>
            <IconAdd size={14} /> Add Sync Pair
          </button>
        </div>
      </div>

      {pendingInvites.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {pendingInvites.map((invite) => (
            <div key={invite.id} className="glass-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <IconSync size={18} />
              <div style={{ flex: 1, fontSize: 13 }}>
                <b>{invite.hostDeviceName}</b> wants to share <b>"{invite.name}"</b> with this device
              </div>
              <button className="btn small primary" onClick={() => setRespondingInvite(invite)}>Review</button>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="empty-state">Loading…</div>}

      {!loading && pairs.length === 0 && (
        <div className="empty-state" style={{ padding: '40px 0' }}>
          <IconSync size={28} />
          <div style={{ marginTop: 10 }}>No Sync Pairs yet — pick a folder on {deviceNounLower} and where it should sync to.</div>
        </div>
      )}

      {!loading && pairs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {pairs.map((p) => (
            <div key={p.id} className="glass-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
              {p.targetKind === 'device' ? (
                <div style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconDevices size={20} />
                </div>
              ) : (
                <img src={CLOUD_ICONS[baseProviderOf(p.providerId ?? '')]} alt="" style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: '1px 7px',
                      borderRadius: 999,
                      background: p.status === 'active' && !p.paused ? 'rgba(52,199,89,0.15)' : 'var(--surface-2)',
                      color: p.status === 'active' && !p.paused ? '#34c759' : 'var(--text-tertiary)',
                    }}
                  >
                    {p.status === 'active' && !p.paused ? 'Active' : 'Paused'}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{DIRECTION_SHORT[p.direction]}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.localPath}>
                  {p.localPath} → {p.targetKind === 'device'
                    ? `${deviceNames[p.deviceId ?? ''] ?? 'a paired device'} (${p.deviceFolderKind === 'local-folder' ? 'local folder' : 'cloud folder'})`
                    : labelFor(p.providerId)}
                </div>
                {p.sourceDeviceName && (
                  <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', opacity: 0.75, marginTop: 1 }}>
                    Synced from {p.sourceDeviceName}
                  </div>
                )}
                {p.progress && p.progress.total > 0 ? (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 3 }}>
                      {p.progress.active ? (
                        <>({Math.round((p.progress.done / p.progress.total) * 100)}% Done) {p.progress.done}/{p.progress.total} Files</>
                      ) : (
                        <>
                          {p.fileCounts.synced} synced
                          {p.fileCounts.error > 0 && <span style={{ color: 'var(--offline)' }}> · {p.fileCounts.error} need attention</span>}
                        </>
                      )}
                    </div>
                    {p.progress.active && (
                      <div style={{ height: 4, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.max(2, Math.round((p.progress.done / p.progress.total) * 100))}%`,
                            background: 'var(--accent)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {p.fileCounts.synced} synced
                    {p.fileCounts.error > 0 && <span style={{ color: 'var(--offline)' }}> · {p.fileCounts.error} need attention</span>}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="btn small" onClick={() => setBrowsingPair(p)}>Browse Files</button>
                <button className="btn small" onClick={() => window.alliminate.openFolder(p.localPath)}>Open Folder in {fileBrowserName}</button>
                {p.status === 'active' && !p.paused && (
                  <button className="btn small" onClick={() => pause(p.id)}>Pause</button>
                )}
                {p.status === 'active' && p.paused && (
                  <button className="btn small" onClick={() => resume(p.id)}>Resume</button>
                )}
                <button className="btn small" onClick={() => remove(p.id, p.name)} title="Stop syncing">
                  <IconTrash size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {scopedActivity.length > 0 && (
        <>
          <div className="section-title">Sync Activity</div>
          <div className="glass-card activity-list" style={{ marginBottom: 24, maxHeight: 220, overflowY: 'auto' }}>
            {scopedActivity.slice(0, 50).map((a) => (
              <div className="activity-row" key={a.id}>
                <span className={`status-dot ${a.kind === 'error' ? 'offline' : 'online'}`} />
                <span className="msg" dangerouslySetInnerHTML={{ __html: a.text }} />
                <span className="ts">{timeAgo(a.ts)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <SyncFromDeviceSection />

      <div className="section-title">Ignore Rules</div>
      <div className="glass-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 10 }}>
          Files and folders matching these patterns never sync — applies to every Sync Pair and Auto-Sync folder.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {rules.map((r) => (
            <span
              key={r}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '3px 8px', borderRadius: 999, background: 'var(--surface-2)' }}
            >
              {r}
              <button
                onClick={() => removeRule(r)}
                disabled={savingRules}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0, fontSize: 12 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="select-field"
            style={{ flex: 1 }}
            placeholder="e.g. *.tmp or a folder name"
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRule()}
          />
          <button className="btn small" disabled={!newRule.trim() || savingRules} onClick={addRule}>Add</button>
        </div>
      </div>

      {showAdd && (
        <AddSyncPairModal
          storage={storage}
          onClose={() => setShowAdd(false)}
          onCreated={refresh}
        />
      )}

      {showUniversalSync && (
        <CreateUniversalSyncModal
          storage={storage}
          onClose={() => setShowUniversalSync(false)}
          onCreated={refresh}
        />
      )}

      {respondingInvite && (
        <UniversalSyncInviteModal
          invite={respondingInvite}
          onClose={() => setRespondingInvite(null)}
          onResolved={() => {
            setPendingInvites((prev) => prev.filter((i) => i.id !== respondingInvite.id));
            refresh();
          }}
        />
      )}

      {browsingPair && (
        <SyncPairFileBrowser pair={browsingPair} onClose={() => setBrowsingPair(null)} onChanged={refresh} />
      )}
    </section>
  );
}
