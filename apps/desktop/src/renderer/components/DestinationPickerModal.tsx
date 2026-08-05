import React, { useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import type { FolderMeta } from '../lib/types';
import { formatBytes } from '../lib/format';
import { Modal } from './Modal';

export function DestinationPickerModal({
  title,
  folders,
  storage,
  excludeFolderId,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  folders: FolderMeta[];
  storage: ProviderStorage[];
  excludeFolderId: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (destFolderId: string) => void;
}) {
  const options = folders.filter((f) => f.id !== excludeFolderId && f.remotePrefix !== '*');
  const [destFolderId, setDestFolderId] = useState(options[0]?.id ?? '');

  const selectedFolder = options.find((f) => f.id === destFolderId);
  const remaining = storage.find((s) => s.provider === selectedFolder?.provider);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!destFolderId} onClick={() => onConfirm(destFolderId)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {options.length === 0 ? (
        <div className="empty-state">No other folders to move/copy into yet</div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <label>Destination</label>
            <select className="select-field" value={destFolderId} onChange={(e) => setDestFolderId(e.target.value)}>
              {options.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.provider})
                </option>
              ))}
            </select>
          </div>
          {remaining && (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', textAlign: 'right', marginTop: 6 }}>
              {formatBytes(Math.max(0, remaining.totalBytes - remaining.usedBytes))} free of {formatBytes(remaining.totalBytes)}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
