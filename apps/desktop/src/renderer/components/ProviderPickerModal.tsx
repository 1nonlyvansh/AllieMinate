import React, { useState } from 'react';
import type { ProviderStorage } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import { formatBytes } from '../lib/format';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { Modal } from './Modal';

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};

export function ProviderPickerModal({
  title,
  storage,
  excludeProviderId,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  storage: ProviderStorage[];
  excludeProviderId: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (destProviderId: string) => void;
}) {
  const options = storage.filter((s) => s.provider !== excludeProviderId);
  const [providerId, setProviderId] = useState(options[0]?.provider ?? '');

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!providerId} onClick={() => onConfirm(providerId)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
        {options.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No other clouds connected.</div>}
        {options.map((s) => {
          const base = baseProviderOf(s.provider);
          return (
            <button
              key={s.provider}
              className={`btn small${providerId === s.provider ? ' primary' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }}
              onClick={() => setProviderId(s.provider)}
            >
              <img src={CLOUD_ICONS[base]} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
              <span>{s.label ?? PROVIDER_LABEL[base] ?? s.provider}</span>
              <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 11 }}>
                {formatBytes(Math.max(0, s.totalBytes - s.usedBytes))} free
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
