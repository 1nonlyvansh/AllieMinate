import React, { useEffect, useMemo, useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import type { FolderMeta, ActivityEntry, FilesByFolder, PairedDeviceInfo, ClipboardEntry } from '../lib/types';
import { formatBytes, timeAgo } from '../lib/format';
import { IconMac, IconWindows, IconPhone, IconDevices, IconAdd, IconFolder, IconSearch } from '../icons';
import { Thumbnail } from '../components/Thumbnail';
import { PreviewModal, PreviewTarget } from '../components/PreviewModal';
import { Skeleton } from '../components/Skeleton';
import { FolderCardMenu } from '../components/FolderCardMenu';
import { AddFolderModal } from '../components/AddFolderModal';
import { DropdownMenu } from '../components/DropdownMenu';
import { copyFileToClipboard } from '../lib/copyToClipboard';
import { usePairedDevices, buildSendMenuItems, SendableFile } from '../lib/sendActions';
import { NearbyPickerModal } from '../components/NearbyPickerModal';

const TAG_COLORS = ['#3a5fe0', '#16a34a', '#f0a63a', '#c026d3', '#0891b2'];
const API_BASE = 'http://localhost:4310';

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};
const PROVIDER_COLOR: Record<string, string> = {
  b2: '#e2231a',
  'idrive-e2': '#0f9d58',
  'google-drive': '#4285f4',
  mega: '#d9272e',
  pcloud: '#17bfea',
  onedrive: '#0078d4',
};

function platformIcon(platform: string, size: number) {
  if (platform === 'darwin') return <IconMac size={size} />;
  if (platform === 'win32') return <IconWindows size={size} />;
  if (platform === 'android' || platform === 'ios') return <IconPhone size={size} />;
  return <IconDevices size={size} />;
}

export function OverviewView({
  folders,
  filesByFolder,
  activity,
  storage,
  loading,
  onOpenFolder,
  onGoToDevices,
  onRefresh,
  clipboard,
  onClipboardChange,
}: {
  folders: FolderMeta[];
  filesByFolder: FilesByFolder;
  activity: ActivityEntry[];
  storage: ProviderStorage[];
  loading?: boolean;
  onOpenFolder: (id: string) => void;
  onGoToDevices: () => void;
  onRefresh: () => void;
  clipboard: ClipboardEntry;
  onClipboardChange: (c: ClipboardEntry) => void;
}) {
  const [paired, setPaired] = useState<PairedDeviceInfo[]>([]);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [nearbyTarget, setNearbyTarget] = useState<{ file: SendableFile; name: string } | null>(null);
  const devices = usePairedDevices();

  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((data) => setPaired(data.paired ?? []))
      .catch(() => {});
  }, []);

  const providerBreakdown = useMemo(() => {
    const byProvider = new Map<string, number>();
    for (const s of storage) {
      const base = baseProviderOf(s.provider);
      byProvider.set(base, (byProvider.get(base) ?? 0) + s.usedBytes);
    }
    const entries = Array.from(byProvider.entries())
      .filter(([, bytes]) => bytes > 0)
      .map(([provider, bytes]) => ({ provider, bytes, label: PROVIDER_LABEL[provider] ?? provider, color: PROVIDER_COLOR[provider] ?? '#8a8f9a' }));
    const sum = entries.reduce((s, e) => s + e.bytes, 0);
    return { entries, sum };
  }, [storage]);

  const almostFullAccounts = useMemo(() => {
    return storage
      .filter((s) => s.totalBytes > 0 && s.usedBytes / s.totalBytes >= 0.85)
      .map((s) => {
        const base = baseProviderOf(s.provider);
        return {
          key: s.provider,
          label: s.label ?? PROVIDER_LABEL[base] ?? base,
          usedBytes: s.usedBytes,
          totalBytes: s.totalBytes,
          suggestion: base === 'google-drive' ? 'link another Google account for more room' : 'free up some space',
        };
      });
  }, [storage]);

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const recentFiles = useMemo(() => {
    const out: { folderId: string; path: string; size: number; modifiedAt: string; provider: string; folderName: string; hash: string; thumbnailUrl?: string; mimeType?: string }[] = [];
    for (const [folderId, files] of Object.entries(filesByFolder)) {
      const meta = folderMap.get(folderId);
      for (const f of files) {
        out.push({ folderId, path: f.path, size: f.size, modifiedAt: f.modifiedAt, provider: meta?.provider ?? '?', folderName: meta?.name ?? folderId, hash: f.hash, thumbnailUrl: f.thumbnailUrl, mimeType: f.mimeType });
      }
    }
    return out.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()).slice(0, 10);
  }, [filesByFolder, folderMap]);

  const allFiles = useMemo(() => {
    const out: { folderId: string; path: string; size: number; modifiedAt: string; provider: string; folderName: string; hash: string; thumbnailUrl?: string; mimeType?: string }[] = [];
    for (const [folderId, files] of Object.entries(filesByFolder)) {
      const meta = folderMap.get(folderId);
      for (const f of files) {
        out.push({ folderId, path: f.path, size: f.size, modifiedAt: f.modifiedAt, provider: meta?.provider ?? '?', folderName: meta?.name ?? folderId, hash: f.hash, thumbnailUrl: f.thumbnailUrl, mimeType: f.mimeType });
      }
    }
    return out;
  }, [filesByFolder, folderMap]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allFiles.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 60);
  }, [allFiles, searchQuery]);

  function openRecentFile(f: { folderId: string; path: string; size: number; modifiedAt: string; provider: string; folderName: string; hash: string }) {
    setPreview({
      source: { kind: 'folder', folderId: f.folderId },
      key: f.path,
      name: f.path.split('/').pop() ?? f.path,
      size: f.size,
      provider: f.provider,
      folderName: f.folderName,
      modifiedAt: f.modifiedAt,
      hash: f.hash,
    });
  }

  type RecentFile = { folderId: string; path: string; size: number; modifiedAt: string; provider: string; folderName: string; hash: string; thumbnailUrl?: string; mimeType?: string };

  async function downloadRecentFile(f: RecentFile) {
    const res = await fetch(`${API_BASE}/folders/${f.folderId}/download?key=${encodeURIComponent(f.path)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.path.split('/').pop() ?? f.path;
    a.click();
    URL.revokeObjectURL(url);
  }

  function recentFileMenuItems(f: RecentFile) {
    const name = f.path.split('/').pop() ?? f.path;
    const sendFile: SendableFile = { kind: 'cloud', folderId: f.folderId, key: f.path, mimeType: f.mimeType };
    return [
      { label: 'Preview', onClick: () => openRecentFile(f) },
      { label: 'Download', onClick: () => downloadRecentFile(f) },
      { label: 'Copy to Clipboard', onClick: () => copyFileToClipboard({ folderId: f.folderId, key: f.path, mimeType: f.mimeType }) },
      { label: 'Copy', onClick: () => onClipboardChange({ kind: 'file', action: 'copy', items: [{ folderId: f.folderId, path: f.path, name }] }) },
      { label: 'Cut', onClick: () => onClipboardChange({ kind: 'file', action: 'cut', items: [{ folderId: f.folderId, path: f.path, name }] }) },
      { divider: true },
      ...buildSendMenuItems(devices, sendFile, name, () => setNearbyTarget({ file: sendFile, name })),
    ];
  }

  function openActivityFile(a: ActivityEntry) {
    if (!a.folderId || !a.fileKey) return;
    const meta = folderMap.get(a.folderId);
    setPreview({
      source: { kind: 'folder', folderId: a.folderId },
      key: a.fileKey,
      name: a.fileKey.split('/').pop() ?? a.fileKey,
      size: a.size ?? 0,
      provider: meta?.provider ?? '?',
      folderName: meta?.name ?? a.folderId,
      modifiedAt: a.ts,
      hash: '',
    });
  }

  return (
    <section className="view active">
      <div className="hero">
        <h1>AllieMinate</h1>
        <p>A Space With You</p>
      </div>

      <div className="toolbar-row">
        <div className="search-field glass-card" style={{ maxWidth: 420 }}>
          <IconSearch size={14} />
          <input
            placeholder="Search files across every cloud…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {searchQuery.trim() && (
        <>
          <div className="section-title">
            Search Results {searchResults.length > 0 && `(${searchResults.length}${searchResults.length === 60 ? '+' : ''})`}
          </div>
          {searchResults.length === 0 ? (
            <div className="glass-card empty-state">No files match "{searchQuery}"</div>
          ) : (
            <div className="recent-grid">
              {searchResults.map((f) => (
                <div key={f.folderId + f.path} className="folder-card recent-card glass-card" onClick={() => openRecentFile(f)}>
                  <DropdownMenu items={recentFileMenuItems(f)} />
                  <Thumbnail folderId={f.folderId} fileKey={f.path} name={f.path.split('/').pop() ?? f.path} size={f.size} thumbnailUrl={f.thumbnailUrl} />
                  <div className="folder-name">{f.path.split('/').pop()}</div>
                  <div className="folder-meta">{f.folderName} · {timeAgo(f.modifiedAt)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!searchQuery.trim() && (
        <>
          {almostFullAccounts.length > 0 && (
            <div className="glass-card" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {almostFullAccounts.map((a) => (
                <div key={a.key} style={{ fontSize: 12.5, color: 'var(--warning)' }}>
                  <b>{a.label}</b> is almost full ({formatBytes(a.usedBytes)} / {formatBytes(a.totalBytes)}) — {a.suggestion}.
                </div>
              ))}
            </div>
          )}

          <div className="section-title">Devices</div>
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
              <div key={d.id} className="device-card glass-card" style={{ cursor: 'pointer', opacity: d.online ? 1 : 0.6 }} onClick={onGoToDevices}>
                <div className="device-icon">{platformIcon(d.platform, 34)}</div>
                <div className="device-name">{d.name}</div>
                <div className="device-meta">{d.platform}</div>
                <div className={`status-pill ${d.online ? 'online' : 'offline'}`}>
                  <span className={`status-dot ${d.online ? 'online' : 'offline'}`} /> {d.online ? 'Online' : 'Offline'}
                </div>
              </div>
            ))}
            <div className="device-card glass-card" style={{ opacity: 0.8, cursor: 'pointer' }} onClick={onGoToDevices}>
              <div className="device-icon">
                <IconAdd size={34} />
              </div>
              <div className="device-name">Pair a device</div>
              <div className="device-meta">same WiFi network</div>
            </div>
          </div>

          <div className="section-title">
            Pinned Folders
          </div>
          <div className="folder-grid">
            {loading && folders.length === 0 && [0, 1, 2, 3].map((i) => (
              <div className="folder-card glass-card skeleton-folder-card" key={`sk-${i}`}>
                <Skeleton width={30} height={30} radius={8} />
                <Skeleton width="70%" height={12} />
                <Skeleton width="45%" height={10} />
              </div>
            ))}
            {!loading && folders.filter((f) => f.pinned !== false).map((f, i) => {
              const files = filesByFolder[f.id] ?? [];
              return (
                <div key={f.id} className="folder-card glass-card" onClick={() => onOpenFolder(f.id)}>
                  <span className="folder-tag" style={{ background: TAG_COLORS[i % TAG_COLORS.length] }} />
                  <FolderCardMenu folder={f} onChanged={onRefresh} onClipboardChange={onClipboardChange} />
                  <div className="folder-icon">
                    <IconFolder size={30} />
                  </div>
                  <div className="folder-name">{f.name}</div>
                  <div className="folder-meta">{f.provider}</div>
                </div>
              );
            })}
            <div className="folder-card add" onClick={() => setShowAddFolder(true)}>
              <div className="folder-icon">
                <IconAdd size={26} />
              </div>
              <div className="folder-name">Add Folder</div>
            </div>
          </div>

          {showAddFolder && (
            <AddFolderModal
              folders={folders}
              storage={storage}
              onClose={() => setShowAddFolder(false)}
              onDone={onRefresh}
            />
          )}

          {providerBreakdown.sum > 0 && (
            <>
              <div className="section-title">Storage Breakdown</div>
              <div className="glass-card" style={{ padding: '18px 20px' }}>
                <div className="stacked-bar">
                  {providerBreakdown.entries.map((e) => (
                    <span key={e.provider} style={{ width: `${(e.bytes / providerBreakdown.sum) * 100}%`, background: e.color }} />
                  ))}
                </div>
                <div className="chart-legend">
                  {providerBreakdown.entries.map((e) => (
                    <div className="item" key={e.provider}>
                      <span className="swatch" style={{ background: e.color }} /> {e.label} — {formatBytes(e.bytes)}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="section-title">Recent Files</div>
          {loading ? (
            <div className="recent-grid">
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="folder-card recent-card glass-card skeleton-thumb-card" key={`sk-${i}`}>
                  <Skeleton width="100%" height={0} style={{ aspectRatio: '4 / 3', borderRadius: 8 }} />
                  <Skeleton width="80%" height={11} />
                  <Skeleton width="55%" height={9} />
                </div>
              ))}
            </div>
          ) : recentFiles.length === 0 ? (
            <div className="glass-card empty-state">Nothing synced yet</div>
          ) : (
            <div className="recent-grid">
              {recentFiles.map((f) => (
                <div key={f.folderId + f.path} className="folder-card recent-card glass-card" onClick={() => openRecentFile(f)}>
                  <DropdownMenu items={recentFileMenuItems(f)} />
                  <Thumbnail folderId={f.folderId} fileKey={f.path} name={f.path.split('/').pop() ?? f.path} size={f.size} thumbnailUrl={f.thumbnailUrl} />
                  <div className="folder-name">{f.path.split('/').pop()}</div>
                  <div className="folder-meta">{f.folderName} · {timeAgo(f.modifiedAt)}</div>
                </div>
              ))}
            </div>
          )}

          {activity.length > 0 && (
            <>
              <div className="section-title">Recent Activity</div>
              <div className="glass-card activity-list">
                {activity.slice(0, 8).map((a) => (
                  <div
                    className="activity-row"
                    key={a.id}
                    style={{ cursor: a.folderId && a.fileKey ? 'pointer' : 'default' }}
                    onClick={() => openActivityFile(a)}
                  >
                    <span className={`status-dot ${a.kind === 'error' ? 'offline' : 'online'}`} />
                    <span className="msg" dangerouslySetInnerHTML={{ __html: a.text }} />
                    <span className="ts">{timeAgo(a.ts)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {preview && <PreviewModal file={preview} apiBase={API_BASE} onClose={() => setPreview(null)} />}

      {nearbyTarget && (
        <NearbyPickerModal file={nearbyTarget.file} fileName={nearbyTarget.name} onClose={() => setNearbyTarget(null)} />
      )}
    </section>
  );
}
