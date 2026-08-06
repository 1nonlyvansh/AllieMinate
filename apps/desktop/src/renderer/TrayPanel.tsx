import React, { useEffect, useState } from 'react';
import { baseProviderOf } from '@alliminate/shared';
import type { PairedDeviceInfo } from './lib/types';
import { Thumbnail } from './components/Thumbnail';
import { Skeleton } from './components/Skeleton';
import { DropdownMenu } from './components/DropdownMenu';
import { NearbyPickerModal } from './components/NearbyPickerModal';
import { usePairedDevices, buildSendMenuItems, sendFileToDevice, SendableFile } from './lib/sendActions';
import { formatBytes, timeAgo, broadCategorize } from './lib/format';
import { IconMac, IconWindows, IconHome, IconCloud, IconDevices, IconDownload, IconCopy, IconShare } from './icons';
import { isWindows, thisDeviceLabel, deviceNounLower, fileBrowserName } from './lib/platformLabels';
import { CLOUD_ICONS } from './lib/cloudIcons';

const API_BASE = 'http://localhost:4310';

const BASE_PROVIDER_LABEL: Record<string, string> = {
  'google-drive': 'Google Drive', b2: 'Backblaze B2', 'idrive-e2': 'IDrive e2',
  mega: 'MEGA', pcloud: 'pCloud', onedrive: 'OneDrive',
};

interface RecentFile {
  folderId: string;
  folderName: string;
  provider: string;
  path: string;
  size: number;
  modifiedAt: string;
  thumbnailUrl?: string;
  // set instead of a real folderId when this came from the whole-account fallback scan (the selected
  // provider dropdown account has no tracked pinned folder with content) — routes downloads through
  // /providers/:id/download instead of /folders/:id/download, same branch Thumbnail already supports.
  providerId?: string;
}
interface LocalRecentFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

interface DeviceRecentFile {
  deviceId: string;
  deviceName: string;
  folderId: string;
  path: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}
interface DropFolder {
  id: string;
  name: string;
  provider: string;
  displayName: string;
}
interface DropDevice {
  id: string;
  name: string;
}
interface NearbyPeer {
  id: string;
  name: string;
  platform: string;
}
interface FileProgress {
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
}
interface TrayState {
  mode: 'recent' | 'drop';
  folders?: DropFolder[];
  devices?: DropDevice[];
  nearbyPeers?: NearbyPeer[];
  fileNames?: string[];
  kind?: 'cloud' | 'device' | 'nearby' | 'both';
  status?: 'idle' | 'sending' | 'done';
  sentTo?: string;
  progress?: FileProgress[];
}

function DropZone({
  icon,
  label,
  hint,
  onFilesDropped,
  onEmpty,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onFilesDropped: (paths: string[]) => void;
  onEmpty: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`tray-dropzone${dragOver ? ' drag-over' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => window.alliminate.getPathForFile(f))
          .filter((p): p is string => !!p);
        if (paths.length > 0) onFilesDropped(paths);
        else onEmpty();
      }}
    >
      <div className="tray-dropzone-icon">{icon}</div>
      <div className="tray-dropzone-label">{label}</div>
      <div className="tray-dropzone-hint">{hint}</div>
    </div>
  );
}

// real MediaStore-generated thumbnail for a phone image/video file, falling back to the generic device
// file icon for anything else (or if the thumbnail request fails) — this is what was missing from the
// tray's device file cards before; RemoteBrowser (the full Devices page) already had it.
function DeviceFileThumb({ f, size = 22 }: { f: DeviceRecentFile; size?: number }) {
  const category = broadCategorize(f.path, f.mimeType);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isMedia = category === 'image' || category === 'video';

  if (!isMedia || failed) {
    return <div className="tray-device-file-icon"><IconDevices size={size} /></div>;
  }
  return (
    <div className="tray-device-file-thumb-wrap">
      {/* icon stays visible underneath until the thumbnail actually loads — same fade-in fix as the cloud
          Thumbnail component, so this card doesn't sit on a bare grey square while it fetches over LAN. */}
      {!loaded && <div className="tray-device-file-icon"><IconDevices size={size} /></div>}
      <img
        className={`tray-device-file-thumb${loaded ? ' loaded' : ' loading'}`}
        src={`${API_BASE}/devices/${f.deviceId}/folders/${f.folderId}/thumbnail?key=${encodeURIComponent(f.path)}`}
        alt=""
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// horizontal, scrollable strip of a single device's most-recent files — revealed with a slide/fade-in
// animation when its device row is clicked in the tray's Recent Devices Files tab.
function DeviceRecentStrip({ deviceId }: { deviceId: string }) {
  const [files, setFiles] = useState<DeviceRecentFile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/devices/${deviceId}/recent?limit=6`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setFiles(data.files ?? []);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const shown = files;

  function url(f: DeviceRecentFile): string {
    return `${API_BASE}/devices/${f.deviceId}/folders/${f.folderId}/download?key=${encodeURIComponent(f.path)}`;
  }

  return (
    <div className="tray-device-strip">
      {files === null && (
        <div className="tray-device-strip-row">
          {[0, 1, 2].map((i) => (
            <div className="tray-device-strip-card" key={`sk-${i}`}>
              <Skeleton width="100%" height={0} style={{ aspectRatio: '1', borderRadius: 8 }} />
            </div>
          ))}
        </div>
      )}
      {shown !== null && shown.length === 0 && (
        <div className="tray-device-strip-empty">No recent files on this device</div>
      )}
      {shown !== null && shown.length > 0 && (
        <div className="tray-device-strip-row">
          {shown.map((f) => {
            const name = f.path.split('/').pop() ?? f.path;
            return (
              <RecentFileCard
                key={f.folderId + f.path}
                url={url(f)}
                filename={name}
                onClick={async () => {
                  // there's no local copy of a phone file until it's actually fetched — reuse the same
                  // temp-cache download prepareFileForDrag already does for native drag-out, then reveal
                  // that cached copy, so clicking a device file behaves the same way This Mac's own files
                  // do (open Finder at the file) instead of triggering a browser-style download/open.
                  const result = await window.alliminate.prepareFileForDrag(url(f), name);
                  if (result.ok && result.path) window.alliminate.showInFinder(result.path);
                }}
              >
                <DeviceFileThumb f={f} size={20} />
                <div className="tray-recent-name">{name}</div>
                <div className="tray-recent-meta">{formatBytes(f.size)}</div>
              </RecentFileCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FileCardActions({ url, filename }: { url: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const result = await window.alliminate.copyFile(url, filename);
    if (result.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  }

  return (
    <div className="tray-recent-card-actions">
      <button className={`tray-icon-btn${copied ? ' copied' : ''}`} title={copied ? 'Copied!' : 'Copy'} onClick={handleCopy}>
        <IconCopy size={13} />
      </button>
      <button
        className="tray-icon-btn"
        title="Download"
        onClick={(e) => {
          e.stopPropagation();
          window.open(url);
        }}
      >
        <IconDownload size={13} />
      </button>
    </div>
  );
}

// Copy + Share for a file that's already local (the This Mac strip) — Download doesn't make sense here
// the way it does for a cloud/phone card, the file's already on disk; Share opens the same reusable
// Send-to-Device/Nearby picker every other file view in the app already uses.
function MacFileCardActions({ localPath, url, filename, onShareNearby }: { localPath: string; url: string; filename: string; onShareNearby: () => void }) {
  const [copied, setCopied] = useState(false);
  const devices = usePairedDevices();
  const sendFile: SendableFile = { kind: 'local', path: localPath };

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const result = await window.alliminate.copyFile(url, filename);
    if (result.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  }

  return (
    <div className="tray-recent-card-actions" onClick={(e) => e.stopPropagation()}>
      <button className={`tray-icon-btn${copied ? ' copied' : ''}`} title={copied ? 'Copied!' : 'Copy'} onClick={handleCopy}>
        <IconCopy size={13} />
      </button>
      <DropdownMenu
        trigger={<IconShare size={13} />}
        items={buildSendMenuItems(devices, sendFile, filename, onShareNearby)}
      />
    </div>
  );
}

// native OS drag-out for a recent-file card. Electron's startDrag() needs a real local file path already
// on disk by the time the browser's dragstart event fires — there's no way to await a download mid-drag —
// so mousedown kicks off the download into a cached temp file ahead of time, and dragstart just uses
// whatever's ready. On a fast flick before the download lands, the browser's own default drag is
// suppressed (preventDefault) rather than falling through to the broken "drag a generic web item" gesture
// that showed a globe cursor and never actually dropped anything.
function useFileDrag(url: string, filename: string) {
  const preparedPath = React.useRef<string | null>(null);

  return {
    draggable: true,
    onMouseDown: () => {
      if (preparedPath.current) return;
      window.alliminate.prepareFileForDrag(url, filename).then((result) => {
        if (result.ok && result.path) preparedPath.current = result.path;
      });
    },
    onDragStart: (e: React.DragEvent) => {
      e.preventDefault();
      if (preparedPath.current) window.alliminate.startFileDrag(preparedPath.current);
    },
  };
}

function RecentFileCard({
  url,
  filename,
  onClick,
  children,
  actions,
}: {
  url: string;
  filename: string;
  onClick: () => void;
  children: React.ReactNode;
  /** Overrides the default Copy+Download actions — used by the This Mac strip, which shows Copy+Share
   * instead (the file's already local, "download" doesn't mean anything there). */
  actions?: React.ReactNode;
}) {
  const dragProps = useFileDrag(url, filename);
  return (
    <div className="tray-recent-card" onClick={onClick} {...dragProps}>
      {children}
      {actions ?? <FileCardActions url={url} filename={filename} />}
    </div>
  );
}

// "This Mac" in the Recent Devices Files tab — the Mac's own recently-touched local files, shown the
// exact same horizontal-scroller way a paired phone's recent files are, via /local/recent instead of a
// device's LAN-reachable HTTP server.
function MacRecentStrip({ onShareNearby }: { onShareNearby: (file: SendableFile, name: string) => void }) {
  const [files, setFiles] = useState<LocalRecentFile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/local/recent?limit=6`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setFiles(data.files ?? []);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = files;

  function url(f: LocalRecentFile): string {
    return `${API_BASE}/local/download?path=${encodeURIComponent(f.path)}`;
  }

  return (
    <div className="tray-device-strip">
      {shown === null && (
        <div className="tray-device-strip-row">
          {[0, 1, 2].map((i) => (
            <div className="tray-device-strip-card" key={`sk-${i}`}>
              <Skeleton width="100%" height={0} style={{ aspectRatio: '1', borderRadius: 8 }} />
            </div>
          ))}
        </div>
      )}
      {shown !== null && shown.length === 0 && (
        <div className="tray-device-strip-empty">No recent files on {deviceNounLower}</div>
      )}
      {shown !== null && shown.length > 0 && (
        <div className="tray-device-strip-row">
          {shown.map((f) => (
            <RecentFileCard
              key={f.path}
              url={url(f)}
              filename={f.name}
              onClick={() => window.alliminate.showInFinder(f.path)}
              actions={
                <MacFileCardActions
                  localPath={f.path}
                  url={url(f)}
                  filename={f.name}
                  onShareNearby={() => onShareNearby({ kind: 'local', path: f.path, mimeType: f.mimeType }, f.name)}
                />
              }
            >
              <Thumbnail directUrl={url(f)} fileKey={f.path} name={f.name} size={f.size} />
              <div className="tray-recent-name">{f.name}</div>
              <div className="tray-recent-meta">{formatBytes(f.size)}</div>
            </RecentFileCard>
          ))}
        </div>
      )}
    </div>
  );
}

// small fixed bar at the BOTTOM of the panel while a transfer is in flight (or just finished) — the rest
// of the panel (Recent Files, tabs) stays visible/usable behind it, matching O+ Connect's menu bar UI
// instead of the old behavior of blanking the whole panel out for the duration of the transfer.
function TrayMiniProgressBar({ tray, onStop, onDismissDone }: { tray: TrayState; onStop: () => void; onDismissDone: () => void }) {
  const progress = tray.progress ?? [];
  const doneCount = progress.filter((p) => p.status === 'done' || p.status === 'error').length;
  const pct = progress.length > 0 ? Math.round((doneCount / progress.length) * 100) : 0;
  const current = progress.find((p) => p.status === 'uploading');

  if (tray.status === 'done') {
    return (
      <div className="tray-mini-progress">
        <div className="tray-mini-progress-row">
          <span className="tray-mini-progress-title">✓ Sent to {tray.sentTo}</span>
          <button className="tray-mini-progress-action" onClick={onDismissDone}>OK</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tray-mini-progress">
      <div className="tray-mini-progress-row">
        <span className="tray-mini-progress-title">
          {pct}% sent{current ? ` — ${current.name}` : progress.length > 1 ? ` (${doneCount}/${progress.length})` : ''}
        </span>
        <button className="tray-mini-progress-action" onClick={onStop}>Stop</button>
      </div>
      <div className="tray-progress-bar-track" style={{ margin: 0 }}>
        <div className="tray-progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function TrayPanel(): JSX.Element {
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tray, setTray] = useState<TrayState>({ mode: 'recent' });
  const [recentTab, setRecentTab] = useState<'cloud' | 'devices'>('cloud');
  const [deviceFilesLoading, setDeviceFilesLoading] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDeviceInfo[] | null>(null);
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  const [macExpanded, setMacExpanded] = useState(false);
  const [nearbyTarget, setNearbyTarget] = useState<{ file: SendableFile; name: string } | null>(null);
  // '' = Combined (every connected cloud). Lives right in the panel, next to the files it controls, so
  // changing it refetches immediately — no separate Settings screen, no save step, no stale-until-reopen
  // gap. Restored from the last selection on mount, but from then on the panel is the source of truth.
  const [providerFilter, setProviderFilter] = useState('');
  const [providerOptions, setProviderOptions] = useState<{ id: string; label: string }[]>([]);
  // a drag hovering the ALREADY-OPEN panel (e.g. opened by clicking the icon, then dragging a file onto
  // it) used to fall through to the old single-list drop view because it never went through the native
  // tray drag-enter path that sets tray.mode to 'drop' — the two zones only ever showed up if you
  // managed to hover the tiny menu-bar icon itself first. Tracking hover locally means the zones show up
  // the moment a drag enters the panel, regardless of how it got opened.
  const [localDragActive, setLocalDragActive] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  function loadRecent(provider: string = providerFilter) {
    setLoading(true);
    // always send ?provider= explicitly (empty string for Combined) — this is what makes the dropdown
    // change take effect immediately in THIS open panel, instead of only on the next reopen.
    fetch(`${API_BASE}/recent?limit=6&provider=${encodeURIComponent(provider)}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setFiles(data.files ?? []))
      .catch(() => setError('AllieMinate backend unreachable'))
      .finally(() => setLoading(false));
  }

  function changeProviderFilter(next: string) {
    setProviderFilter(next);
    loadRecent(next);
  }

  // used to fetch /devices/recent too, for an always-visible merged grid below the device rows — dropped
  // in favor of ONLY the per-device click-to-expand horizontal scroller (DeviceRecentStrip), which fetches
  // its own files on demand. That also means this no longer needs the expensive cross-device fan-out at
  // all just to populate the device row list + online count.
  function loadDeviceRecent() {
    setDeviceFilesLoading(true);
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((devices) => setPairedDevices(devices.paired ?? []))
      .catch(() => setPairedDevices([]))
      .finally(() => setDeviceFilesLoading(false));
  }

  // restores the last-picked filter (so the dropdown doesn't silently reset to Combined every cold open)
  // and loads the connected-account list for the dropdown's options, in parallel with the first fetch.
  useEffect(() => {
    fetch(`${API_BASE}/settings/tray-filter`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        const initial = data.providerId ?? '';
        setProviderFilter(initial);
        loadRecent(initial);
      })
      .catch(() => loadRecent(''));

    Promise.all([
      fetch(`${API_BASE}/status`).then((res) => res.json()),
      fetch(`${API_BASE}/accounts`).then((res) => res.json()).catch(() => ({ accounts: [] })),
    ])
      .then(([status, accounts]) => {
        const driveLabels: Record<string, string> = {};
        (accounts.accounts ?? []).forEach((a: { accountId: string; label: string }) => {
          driveLabels[a.accountId] = a.label;
        });
        const options = ((status.providers ?? []) as string[]).map((id) => ({
          id,
          label: driveLabels[id] ?? BASE_PROVIDER_LABEL[baseProviderOf(id)] ?? id,
        }));
        setProviderOptions(options);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (recentTab === 'devices' && pairedDevices === null) loadDeviceRecent();
  }, [recentTab]);

  useEffect(() => {
    return window.alliminate.onTrayState((state) => {
      setTray((prev) => ({ ...prev, ...(state as TrayState) }));
    });
  }, []);

  function dismissDrop() {
    setTray({ mode: 'recent' });
    loadRecent();
  }

  function cancelDrop() {
    window.alliminate.cancelDrop();
    dismissDrop();
  }

  useEffect(() => {
    if (tray.mode === 'drop' && tray.status === 'done') {
      const t = setTimeout(dismissDrop, 3000);
      return () => clearTimeout(t);
    }
  }, [tray.mode, tray.status]);

  // a real OS drag session can end without ever firing a clean dragleave/drop back to this window (seen
  // after interrupting a drag mid-gesture) — that left localDragActive stuck true forever with no way to
  // dismiss it, since this state used to render zones with no Cancel button at all. Auto-clear after a
  // few seconds of inactivity as a backstop, on top of adding a real Cancel button below.
  useEffect(() => {
    if (!localDragActive) return;
    const t = setTimeout(() => setLocalDragActive(false), 8000);
    return () => clearTimeout(t);
  }, [localDragActive]);

  function fileUrl(f: RecentFile): string {
    return f.providerId
      ? `${API_BASE}/providers/${f.providerId}/download?key=${encodeURIComponent(f.path)}`
      : `${API_BASE}/folders/${f.folderId}/download?key=${encodeURIComponent(f.path)}`;
  }
  function openFile(f: RecentFile) {
    window.open(fileUrl(f));
  }

  const dropReady = (tray.fileNames?.length ?? 0) > 0;
  const folders = tray.folders ?? [];
  const devices = tray.devices ?? [];
  const nearbyDevices = tray.nearbyPeers ?? [];
  const kind = tray.kind ?? 'both';
  const showDropZones = tray.mode === 'recent' && localDragActive && !dropReady;
  // once a transfer actually starts (or just finished), collapse down to a small bottom bar instead of
  // covering the whole panel — the Recent Files view stays visible/usable underneath, matching O+ Connect.
  const transferring = tray.status === 'sending' || tray.status === 'done';
  const showFullDropPicker = tray.mode === 'drop' && !transferring;
  const showRecentContent = (tray.mode === 'recent' && !showDropZones) || (tray.mode === 'drop' && transferring);

  return (
    <div
      className="tray-panel"
      onMouseEnter={() => window.alliminate.keepPanelOpen()}
      onMouseLeave={() => window.alliminate.notifyPanelHoverLeave()}
      onDragEnter={(e) => {
        e.preventDefault();
        setDropError(null);
        setLocalDragActive(true);
        window.alliminate.keepPanelOpen();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setLocalDragActive(false);
        window.alliminate.notifyPanelDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        setLocalDragActive(false);
        // only a safety net for drops landing in the header/gaps outside either zone — the zones
        // themselves (rendered whenever showDropZones is true) handle the real case and stopPropagation.
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => window.alliminate.getPathForFile(f))
          .filter((p): p is string => !!p);
        if (paths.length > 0) {
          window.alliminate.dropFilesInPanel(paths);
        } else if (e.dataTransfer.files.length > 0) {
          setDropError(`Couldn't read that as a file — try dragging it from ${fileBrowserName} instead.`);
        }
      }}
    >
      <div className="tray-header">
        <span className="brand-mark" style={{ width: 22, height: 22 }} />
        <span className="tray-title">AllieMinate</span>
        <button
          className="tray-home-btn"
          title="Open AllieMinate"
          onClick={() => window.alliminate.openApp()}
        >
          <IconHome size={16} />
        </button>
      </div>

      {tray.mode === 'recent' && showDropZones && (
        <>
          <div className="tray-drop-title">Drag files onto a section</div>
          <div className="tray-dropzones">
            <DropZone
              icon={<IconCloud size={22} />}
              label="Cloud Transfer"
              hint="Save to a connected cloud"
              onFilesDropped={(paths) => window.alliminate.dropFilesInPanel(paths, 'cloud')}
              onEmpty={() => setDropError(`Couldn't read that as a file — try dragging it from ${fileBrowserName} instead.`)}
            />
            <DropZone
              icon={<IconDevices size={22} />}
              label="Devices"
              hint="Share to a paired device"
              onFilesDropped={(paths) => window.alliminate.dropFilesInPanel(paths, 'device')}
              onEmpty={() => setDropError(`Couldn't read that as a file — try dragging it from ${fileBrowserName} instead.`)}
            />
            <DropZone
              icon={<IconShare size={22} />}
              label="Share Nearby"
              hint="Instant send to a nearby device"
              onFilesDropped={(paths) => window.alliminate.dropFilesInPanel(paths, 'nearby')}
              onEmpty={() => setDropError(`Couldn't read that as a file — try dragging it from ${fileBrowserName} instead.`)}
            />
          </div>
          {dropError && <div className="empty-state" style={{ padding: '10px 0', color: 'var(--offline)', fontSize: 11.5 }}>{dropError}</div>}
          <button className="btn small tray-cancel-btn" onClick={() => setLocalDragActive(false)}>Cancel</button>
        </>
      )}

      {showRecentContent && (
        <>
          <div className="tray-tabs">
            <button className={`tray-tab${recentTab === 'cloud' ? ' active' : ''}`} onClick={() => setRecentTab('cloud')}>
              <IconCloud size={13} /> Recent Cloud Files
            </button>
            <button className={`tray-tab${recentTab === 'devices' ? ' active' : ''}`} onClick={() => setRecentTab('devices')}>
              <IconDevices size={13} /> Recent Devices Files
            </button>
          </div>

          <button
            className="tray-view-link"
            onClick={() => window.alliminate.openApp(recentTab === 'cloud' ? 'files' : 'devices')}
          >
            View all in AllieMinate →
          </button>

          {recentTab === 'cloud' && (
            <>
              <select
                className="select-field"
                style={{ marginBottom: 10, width: '100%' }}
                value={providerFilter}
                onChange={(e) => changeProviderFilter(e.target.value)}
              >
                <option value="">Combined (All Clouds)</option>
                {providerOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>

              {loading && (
                <div className="tray-recent-grid">
                  {[0, 1, 2, 3].map((i) => (
                    <div className="tray-recent-card" key={`sk-${i}`}>
                      <Skeleton width="100%" height={0} style={{ aspectRatio: '1', borderRadius: 8 }} />
                      <Skeleton width="80%" height={10} style={{ marginTop: 6 }} />
                      <Skeleton width="55%" height={9} style={{ marginTop: 4 }} />
                    </div>
                  ))}
                </div>
              )}
              {error && <div className="empty-state" style={{ padding: '20px 0', color: 'var(--offline)' }}>{error}</div>}
              {!loading && !error && files.length === 0 && (
                <div className="empty-state" style={{ padding: '20px 0' }}>Nothing synced yet</div>
              )}

              {!loading && !error && files.length > 0 && (
                <div className="tray-recent-grid">
                  {files.map((f) => {
                    const name = f.path.split('/').pop() ?? f.path;
                    return (
                      <RecentFileCard key={f.folderId + f.path} url={fileUrl(f)} filename={name} onClick={() => openFile(f)}>
                        <Thumbnail folderId={f.providerId ? undefined : f.folderId} providerId={f.providerId} fileKey={f.path} name={name} size={f.size} thumbnailUrl={f.thumbnailUrl} />
                        <div className="tray-recent-name">{name}</div>
                        <div className="tray-recent-meta">{formatBytes(f.size)} · {timeAgo(f.modifiedAt)}</div>
                      </RecentFileCard>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {recentTab === 'devices' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: (pairedDevices?.length ?? 0) > 0 ? 4 : 0 }}>
                <div
                  className="tray-device-row clickable"
                  onClick={() => setMacExpanded((v) => !v)}
                >
                  {isWindows ? <IconWindows size={16} /> : <IconMac size={16} />}
                  <span>{thisDeviceLabel}</span>
                  <span className="status-pill online" style={{ marginLeft: 'auto' }}>
                    <span className="status-dot online" /> Online
                  </span>
                </div>
                {macExpanded && (
                  <MacRecentStrip
                    onShareNearby={(file, name) => setNearbyTarget({ file, name })}
                  />
                )}
              </div>

              {!deviceFilesLoading && pairedDevices && pairedDevices.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {pairedDevices.map((d) => {
                    const expanded = expandedDeviceId === d.id;
                    return (
                      <div key={d.id}>
                        <div
                          className={`tray-device-row${d.online ? ' clickable' : ''}`}
                          onClick={() => d.online && setExpandedDeviceId(expanded ? null : d.id)}
                        >
                          <IconDevices size={16} />
                          <span>{d.name}</span>
                          <span className={`status-pill ${d.online ? 'online' : 'offline'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`status-dot ${d.online ? 'online' : 'offline'}`} /> {d.online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        {expanded && <DeviceRecentStrip deviceId={d.id} />}
                      </div>
                    );
                  })}
                  {pairedDevices.some((d) => d.online) && (
                    <div className="tray-section-label" style={{ marginTop: -2, marginBottom: 4 }}>
                      Click an online device to see its recent files
                    </div>
                  )}
                </div>
              )}
              {deviceFilesLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[0, 1].map((i) => <Skeleton key={i} width="100%" height={38} style={{ borderRadius: 10 }} />)}
                </div>
              )}
              {!deviceFilesLoading && pairedDevices && pairedDevices.length === 0 && (
                <div className="empty-state" style={{ padding: '20px 0' }}>No paired devices yet</div>
              )}
              {!deviceFilesLoading && (pairedDevices?.length ?? 0) > 0 && !pairedDevices?.some((d) => d.online) && (
                <div className="empty-state" style={{ padding: '20px 0' }}>No Active Devices Found</div>
              )}
            </>
          )}

          {dropError && <div className="empty-state" style={{ padding: '6px 0', color: 'var(--offline)', fontSize: 11.5 }}>{dropError}</div>}
          <div className="tray-footer">Drag a file here to save or share it</div>
        </>
      )}

      {showFullDropPicker && (
        <div className="tray-drop">
          {!dropReady ? (
            <>
              <div className="tray-drop-title">Drag files onto a section</div>
              <div className="tray-dropzones">
                <DropZone
                  icon={<IconCloud size={22} />}
                  label="Cloud Transfer"
                  hint="Save to a connected cloud"
                  onFilesDropped={(paths) => window.alliminate.dropFilesInPanel(paths, 'cloud')}
                  onEmpty={() => setDropError(`Couldn't read that as a file — try dragging it from ${fileBrowserName} instead.`)}
                />
                <DropZone
                  icon={<IconDevices size={22} />}
                  label="Devices"
                  hint="Share to a paired device"
                  onFilesDropped={(paths) => window.alliminate.dropFilesInPanel(paths, 'device')}
                  onEmpty={() => setDropError(`Couldn't read that as a file — try dragging it from ${fileBrowserName} instead.`)}
                />
                <DropZone
                  icon={<IconShare size={22} />}
                  label="Share Nearby"
                  hint="Instant send to a nearby device"
                  onFilesDropped={(paths) => window.alliminate.dropFilesInPanel(paths, 'nearby')}
                  onEmpty={() => setDropError(`Couldn't read that as a file — try dragging it from ${fileBrowserName} instead.`)}
                />
              </div>
              {dropError && <div className="empty-state" style={{ padding: '6px 0', color: 'var(--offline)', fontSize: 11.5 }}>{dropError}</div>}
              <button className="btn small tray-cancel-btn" onClick={cancelDrop}>Cancel</button>
            </>
          ) : (
            <>
              <div className="tray-drop-title">
                {tray.fileNames!.length} file{tray.fileNames!.length > 1 ? 's' : ''} ready — choose a destination
              </div>

              {(kind === 'cloud' || kind === 'both') && folders.length > 0 && (
                <>
                  <div className="tray-section-label">Save to Cloud</div>
                  {folders.map((f) => (
                    <div key={f.id} className="tray-drop-row" onClick={() => window.alliminate.completeDrop('folder', f.id)}>
                      <img src={CLOUD_ICONS[baseProviderOf(f.provider)]} alt="" className="tray-drop-row-icon" />
                      <span>{f.displayName}</span>
                    </div>
                  ))}
                </>
              )}

              {(kind === 'device' || kind === 'both') && devices.length > 0 && (
                <>
                  <div className="tray-section-label">Share to Device</div>
                  {devices.map((d) => (
                    <div key={d.id} className="tray-drop-row" onClick={() => window.alliminate.completeDrop('device', d.id)}>
                      <span>{d.name}</span>
                    </div>
                  ))}
                </>
              )}

              {kind === 'nearby' && nearbyDevices.length > 0 && (
                <>
                  <div className="tray-section-label">Share Nearby</div>
                  {nearbyDevices.map((d) => (
                    <div key={d.id} className="tray-drop-row" onClick={() => window.alliminate.completeDrop('nearby', d.id)}>
                      <span>{d.name}</span>
                    </div>
                  ))}
                </>
              )}

              {kind === 'cloud' && folders.length === 0 && (
                <div className="empty-state" style={{ padding: '20px 0' }}>No clouds connected</div>
              )}
              {kind === 'device' && devices.length === 0 && (
                <div className="empty-state" style={{ padding: '20px 0' }}>No paired devices online</div>
              )}
              {kind === 'nearby' && nearbyDevices.length === 0 && (
                <div className="empty-state" style={{ padding: '20px 0' }}>
                  No nearby devices found — they need AllieMinate open with Nearby Share on, on the same WiFi
                </div>
              )}
              {kind === 'both' && folders.length === 0 && devices.length === 0 && (
                <div className="empty-state" style={{ padding: '20px 0' }}>No folders or online devices to drop onto</div>
              )}

              {kind === 'cloud' && (
                <button className="tray-escape-btn" onClick={() => window.alliminate.switchDropKind('device')}>
                  Share the file{tray.fileNames!.length > 1 ? 's' : ''} to Devices Instead
                </button>
              )}
              {kind === 'device' && (
                <button className="tray-escape-btn" onClick={() => window.alliminate.switchDropKind('cloud')}>
                  Save the file{tray.fileNames!.length > 1 ? 's' : ''} to Cloud Instead
                </button>
              )}

              <button className="btn small tray-cancel-btn" onClick={cancelDrop}>Cancel</button>
            </>
          )}
        </div>
      )}

      {transferring && (
        <TrayMiniProgressBar tray={tray} onStop={cancelDrop} onDismissDone={dismissDrop} />
      )}

      {nearbyTarget && (
        <NearbyPickerModal file={nearbyTarget.file} fileName={nearbyTarget.name} onClose={() => setNearbyTarget(null)} />
      )}
    </div>
  );
}
