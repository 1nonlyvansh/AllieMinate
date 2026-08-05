import React, { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format';
import { Modal } from './Modal';

const API_BASE = 'http://localhost:4310';

interface Details {
  name: string;
  size: number;
  modifiedAt: string;
  createdAt: string | null;
  provider: string;
  providerLabel: string;
  folderName: string;
}

export function FileDetailsModal({
  folderId,
  providerId,
  fileKey,
  onClose,
}: {
  folderId?: string;
  providerId?: string;
  fileKey: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const scope = folderId ? `folderId=${encodeURIComponent(folderId)}` : `providerId=${encodeURIComponent(providerId ?? '')}`;
    fetch(`${API_BASE}/files/details?${scope}&key=${encodeURIComponent(fileKey)}`)
      .then((res) => res.json())
      .then((data) => (data.error ? setError(data.error) : setDetails(data)))
      .catch(() => setError('Backend unreachable'));
  }, [folderId, providerId, fileKey]);

  return (
    <Modal title="File Details" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error && <div style={{ color: 'var(--offline)' }}>{error}</div>}
      {!details && !error && <div>Loading…</div>}
      {details && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <div><b>{details.name}</b></div>
          <div>Size: {formatBytes(details.size)}</div>
          <div>Modified: {new Date(details.modifiedAt).toLocaleString()}</div>
          <div>Created: {details.createdAt ? new Date(details.createdAt).toLocaleString() : 'Not reported by this cloud'}</div>
          <div>Cloud: {details.providerLabel}</div>
          <div>In: {details.folderName}</div>
        </div>
      )}
    </Modal>
  );
}
