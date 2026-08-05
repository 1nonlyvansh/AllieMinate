import React, { useEffect, useState } from 'react';
import type { PairedDeviceInfo, RemoteFolder } from '../lib/types';
import { Modal } from './Modal';

const API_BASE = 'http://localhost:4310';

// Phase 5: Auto-Sync against a paired device — picks WHICH device, then WHICH of its folders, then turns
// on two-way sync. An Android peer only ever exposes its fixed "received" bucket as a write target (no
// arbitrary folder structure, no delete route), so it still works here but degrades to one-directional —
// flagged directly in the picker rather than silently promising something Android can't actually do.
export function AutoSyncDeviceModal({
  folderId,
  folderName,
  onClose,
  onEnabled,
}: {
  folderId: string;
  folderName: string;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const [devices, setDevices] = useState<PairedDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [remoteFolders, setRemoteFolders] = useState<RemoteFolder[]>([]);
  const [selectedRemoteFolderId, setSelectedRemoteFolderId] = useState('');
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((data: { paired?: PairedDeviceInfo[] }) => setDevices((data.paired ?? []).filter((d) => d.online)))
      .catch(() => {});
  }, []);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const isAndroid = selectedDevice?.platform === 'android';

  useEffect(() => {
    if (!selectedDeviceId) {
      setRemoteFolders([]);
      setSelectedRemoteFolderId('');
      return;
    }
    setLoadingFolders(true);
    fetch(`${API_BASE}/devices/${selectedDeviceId}/folders`)
      .then((res) => res.json())
      .then((data: { folders?: RemoteFolder[] }) => {
        setRemoteFolders(data.folders ?? []);
        setSelectedRemoteFolderId(data.folders?.[0]?.id ?? '');
      })
      .catch(() => setRemoteFolders([]))
      .finally(() => setLoadingFolders(false));
  }, [selectedDeviceId]);

  async function enable() {
    if (!selectedDeviceId || !selectedRemoteFolderId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/folders/${folderId}/auto-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKind: 'device', deviceId: selectedDeviceId, deviceFolderId: selectedRemoteFolderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'could not turn on Auto-Sync');
      onEnabled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Auto-Sync "${folderName}" with a Device`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !selectedDeviceId || !selectedRemoteFolderId} onClick={enable}>
            {busy ? 'Turning on…' : 'Turn On Auto-Sync'}
          </button>
        </>
      }
    >
      {devices.length === 0 && <div className="empty-state">No paired devices online right now</div>}

      {devices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>Device</div>
            <select className="select-field" style={{ width: '100%' }} value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
              <option value="">Choose a device…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {selectedDeviceId && (
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>Its folder</div>
              {loadingFolders ? (
                <div className="empty-state" style={{ padding: '8px 0' }}>Loading…</div>
              ) : (
                <select className="select-field" style={{ width: '100%' }} value={selectedRemoteFolderId} onChange={(e) => setSelectedRemoteFolderId(e.target.value)}>
                  {remoteFolders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {isAndroid && (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              Android phones only have one writable folder ("Received on Phone") and no delete — files sync TO the phone, but changes/deletes made ON the phone won't sync back, and deleting here won't delete there.
            </div>
          )}
        </div>
      )}

      {error && <div style={{ color: 'var(--offline)', fontSize: 11.5, marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}
