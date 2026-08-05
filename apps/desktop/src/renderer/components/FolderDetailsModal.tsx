import React, { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format';
import { Modal } from './Modal';

const API_BASE = 'http://localhost:4310';

interface Details {
  name: string;
  provider: string;
  fileCount: number;
  totalBytes: number;
  byExtension: Record<string, number>;
  earliestFileAt: string | null;
}

export function FolderDetailsModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/folders/${folderId}/details`)
      .then((res) => res.json())
      .then((data) => (data.error ? setError(data.error) : setDetails(data)))
      .catch(() => setError('Backend unreachable'));
  }, [folderId]);

  const topExtensions = details
    ? Object.entries(details.byExtension).sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];

  return (
    <Modal title="Folder Details" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error && <div style={{ color: 'var(--offline)' }}>{error}</div>}
      {!details && !error && <div>Loading…</div>}
      {details && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <div><b>{details.name}</b></div>
          <div>Provider: {details.provider}</div>
          <div>Size: {formatBytes(details.totalBytes)}</div>
          <div>Contains: {details.fileCount} file{details.fileCount === 1 ? '' : 's'}</div>
          {topExtensions.length > 0 && (
            <div>
              {topExtensions.map(([ext, count]) => `${count} ${ext.toUpperCase()}`).join(', ')}
            </div>
          )}
          <div>
            First file added: {details.earliestFileAt ? new Date(details.earliestFileAt).toLocaleString() : '—'}
          </div>
        </div>
      )}
    </Modal>
  );
}
