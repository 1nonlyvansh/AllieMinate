import React, { useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import {
  IconHome,
  IconFiles,
  IconFolder,
  IconDevices,
  IconShare,
  IconTrash,
  IconSettings,
  IconUpload,
  IconChevronLeft,
  IconCloud,
  IconImage,
  IconVideo,
  IconAudio,
  IconDocument,
  IconArchive,
  IconSync,
} from '../icons';
import { Skeleton } from './Skeleton';
import { BRAND_LOGO_DATA_URI } from '../lib/brandLogo';

export type ViewId =
  | 'overview' | 'files' | 'pinned' | 'cloud-services' | 'devices' | 'share' | 'trash' | 'settings' | 'sync'
  | 'cat-image' | 'cat-video' | 'cat-audio' | 'cat-document' | 'cat-archive' | 'google-photos';

const NAV: { id: ViewId; label: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'overview', label: 'Overview', icon: IconHome },
  { id: 'files', label: 'Files', icon: IconFiles },
  { id: 'pinned', label: 'Pinned Folders', icon: IconFolder },
  { id: 'sync', label: 'Sync', icon: IconSync },
  { id: 'cloud-services', label: 'Cloud Services', icon: IconCloud },
  { id: 'google-photos', label: 'Google Photos', icon: IconImage },
  { id: 'devices', label: 'Devices', icon: IconDevices },
  { id: 'share', label: 'Share', icon: IconShare },
  { id: 'trash', label: 'Trash', icon: IconTrash },
];

const CATEGORY_NAV: { id: ViewId; label: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'cat-image', label: 'Images', icon: IconImage },
  { id: 'cat-video', label: 'Videos', icon: IconVideo },
  { id: 'cat-audio', label: 'Audio', icon: IconAudio },
  { id: 'cat-document', label: 'Documents', icon: IconDocument },
  { id: 'cat-archive', label: 'Archives', icon: IconArchive },
];

function providerLabel(id: string): string {
  const names: Record<string, string> = {
    b2: 'Backblaze B2',
    'idrive-e2': 'IDrive e2',
    'google-drive': 'Google Drive',
    mega: 'MEGA',
    pcloud: 'pCloud',
    onedrive: 'OneDrive',
  };
  return names[id] ?? id;
}

function formatGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

export function Sidebar({
  view,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  storage,
  loading,
  onUpload,
  accountEmail,
}: {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  storage: ProviderStorage[];
  loading?: boolean;
  onUpload: () => void;
  accountEmail: string;
}) {
  const [driveExpanded, setDriveExpanded] = useState(false);
  const driveEntries = storage.filter((s) => baseProviderOf(s.provider) === 'google-drive');
  const otherEntries = storage.filter((s) => baseProviderOf(s.provider) !== 'google-drive');
  const driveUsed = driveEntries.reduce((sum, s) => sum + s.usedBytes, 0);
  const driveTotal = driveEntries.reduce((sum, s) => sum + s.totalBytes, 0);
  const drivePct = driveTotal > 0 ? Math.min(100, (driveUsed / driveTotal) * 100) : 0;

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <button className="collapse-btn" onClick={onToggleCollapsed} title="Toggle sidebar">
        <IconChevronLeft size={15} />
      </button>

      <div className="brand">
        <img className="brand-mark" src={BRAND_LOGO_DATA_URI} alt="" />
        <span className="brand-text">AllieMinate</span>
      </div>

      <button className="upload-btn" onClick={onUpload}>
        <IconUpload size={16} />
        <span className="label">Upload Files</span>
      </button>

      <nav className="sidebar-scroll">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item${view === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon size={17} />
            <span className="label">{item.label}</span>
          </button>
        ))}

        <div className="sidebar-section-label">File Types</div>
        {CATEGORY_NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item${view === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon size={17} />
            <span className="label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-section-label">Cloud storage</div>
        {loading && storage.length === 0 && (
          <>
            {[0, 1, 2].map((i) => (
              <div className="storage-row" key={`sk-${i}`}>
                <div className="top">
                  <Skeleton width={70 + i * 10} height={11} />
                  <Skeleton width={54} height={10} />
                </div>
                <Skeleton width="100%" height={4} radius={999} />
              </div>
            ))}
          </>
        )}
        {!loading && driveEntries.length > 0 && (
          <div className="storage-group">
            <div className="storage-row" style={{ cursor: 'pointer' }} onClick={() => setDriveExpanded((v) => !v)}>
              <div className="top">
                <span className="provider label">
                  Google Drive ({driveEntries.length})
                  <span
                    style={{
                      display: 'inline-block',
                      marginLeft: 5,
                      transform: driveExpanded ? 'rotate(90deg)' : 'rotate(-90deg)',
                      opacity: 0.6,
                    }}
                  >
                    <IconChevronLeft size={9} />
                  </span>
                </span>
                <span className="meta">
                  {formatGB(driveUsed)} / {formatGB(driveTotal)} GB Used
                </span>
              </div>
              <div className="meter-track">
                <div className={`meter-fill${drivePct > 85 ? ' warn' : ''}`} style={{ width: `${Math.max(drivePct, 2)}%` }} />
              </div>
            </div>
            {driveExpanded && (
              <div className="storage-subgroup">
                {driveEntries.map((s) => {
                  const pct = Math.min(100, (s.usedBytes / s.totalBytes) * 100);
                  return (
                    <div className="storage-row" key={s.provider}>
                      <div className="top">
                        <span className="provider label">{s.label ?? 'Google Drive'}</span>
                        <span className="meta">
                          {formatGB(s.usedBytes)} / {formatGB(s.totalBytes)} GB
                        </span>
                      </div>
                      <div className="meter-track">
                        <div className={`meter-fill${pct > 85 ? ' warn' : ''}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!loading && otherEntries.map((s) => {
          const pct = Math.min(100, (s.usedBytes / s.totalBytes) * 100);
          return (
            <div className="storage-row" key={s.provider}>
              <div className="top">
                <span className="provider label">{s.label ?? providerLabel(baseProviderOf(s.provider))}</span>
                <span className="meta">
                  {formatGB(s.usedBytes)} / {formatGB(s.totalBytes)} GB
                </span>
              </div>
              <div className="meter-track">
                <div className={`meter-fill${pct > 85 ? ' warn' : ''}`} style={{ width: `${Math.max(pct, 2)}%` }} />
              </div>
            </div>
          );
        })}
        {!loading && storage.length === 0 && <div className="storage-row meta">No clouds connected</div>}

        <div className="account-row" onClick={() => onNavigate('settings')}>
          <span className="avatar">{accountEmail.charAt(0).toUpperCase()}</span>
          <span className="email">{accountEmail}</span>
        </div>
        <button className={`nav-item${view === 'settings' ? ' active' : ''}`} onClick={() => onNavigate('settings')}>
          <IconSettings size={17} />
          <span className="label">Settings</span>
        </button>
      </div>
    </aside>
  );
}
