import React, { useState } from 'react';
import type { FolderMeta, ClipboardEntry } from '../lib/types';
import type { MenuItem } from './DropdownMenu';
import { DropdownMenu } from './DropdownMenu';
import { RenameModal } from './RenameModal';
import { FolderDetailsModal } from './FolderDetailsModal';
import { AutoSyncDeviceModal } from './AutoSyncDeviceModal';

const API_BASE = 'http://localhost:4310';

export function FolderCardMenu({
  folder,
  onChanged,
  onClipboardChange,
}: {
  folder: FolderMeta;
  onChanged: () => void;
  onClipboardChange: (c: ClipboardEntry) => void;
}) {
  const [showRename, setShowRename] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showAutoSyncDevice, setShowAutoSyncDevice] = useState(false);
  const isLibraryView = folder.remotePrefix === '*';
  const pinned = folder.pinned !== false;
  const canAutoSync = folder.hasLocalPath === true;
  const autoSyncOn = folder.autoSync === true;

  async function patch(body: Record<string, unknown>) {
    await fetch(`${API_BASE}/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    onChanged();
  }

  async function enableCloudAutoSync() {
    const res = await fetch(`${API_BASE}/folders/${folder.id}/auto-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'cloud' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error ?? "Couldn't turn on Auto-Sync.");
      return;
    }
    onChanged();
  }

  async function disableAutoSync() {
    await fetch(`${API_BASE}/folders/${folder.id}/auto-sync/disable`, { method: 'POST' });
    onChanged();
  }

  async function duplicate() {
    const res = await fetch(`${API_BASE}/folders/${folder.id}/duplicate`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error ?? "Couldn't duplicate this folder.");
      return;
    }
    onChanged();
  }

  function copy() {
    onClipboardChange({ kind: 'folder', action: 'copy', folderId: folder.id, name: folder.name });
  }

  // cutting picks the folder up off the grid immediately (unpin) — Paste on the Pinned Folders page puts
  // it back down. There's no real destination-folder concept here (folders are flat, not nested), so
  // "elsewhere" just means "pinned again."
  async function cut() {
    onClipboardChange({ kind: 'folder', action: 'cut', folderId: folder.id, name: folder.name });
    await patch({ pinned: false });
  }

  function downloadZip() {
    window.open(`${API_BASE}/folders/${folder.id}/zip`);
  }

  const autoSyncItems: MenuItem[] = !canAutoSync
    ? []
    : autoSyncOn
      ? [{ label: 'Turn Off Auto-Sync', onClick: disableAutoSync }]
      : [
          { label: 'Auto-Sync (this cloud)', onClick: enableCloudAutoSync },
          { label: 'Auto-Sync with a Device…', onClick: () => setShowAutoSyncDevice(true) },
        ];

  const items: MenuItem[] = [
    { label: 'Rename Folder', onClick: () => setShowRename(true) },
    { label: pinned ? 'Unpin from Pinned Folders' : 'Pin to Pinned Folders', onClick: () => patch({ pinned: !pinned }) },
    { divider: true },
    ...(isLibraryView
      ? []
      : ([
          { label: 'Copy', onClick: copy },
          { label: 'Cut', onClick: cut },
          { label: 'Duplicate', onClick: duplicate },
          { label: 'Compress to ZIP File', onClick: downloadZip },
          { divider: true },
        ] as MenuItem[])),
    ...(autoSyncItems.length > 0 ? [...autoSyncItems, { divider: true } as MenuItem] : []),
    { label: 'Details', onClick: () => setShowDetails(true) },
  ];

  return (
    <>
      <DropdownMenu items={items} />
      {showRename && (
        <RenameModal
          currentName={folder.name}
          onClose={() => setShowRename(false)}
          onConfirm={async (newName) => {
            await patch({ name: newName });
            setShowRename(false);
          }}
        />
      )}
      {showDetails && <FolderDetailsModal folderId={folder.id} onClose={() => setShowDetails(false)} />}
      {showAutoSyncDevice && (
        <AutoSyncDeviceModal
          folderId={folder.id}
          folderName={folder.name}
          onClose={() => setShowAutoSyncDevice(false)}
          onEnabled={onChanged}
        />
      )}
    </>
  );
}
