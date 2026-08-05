import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { sendFileNearby, SendableFile } from '../lib/sendActions';

const API_BASE = 'http://localhost:4310';
const NEARBY_POLL_MS = 4000;

interface NearbyPeer {
  id: string;
  name: string;
  platform: string;
}

type SendState = 'picking' | 'sending' | 'done';

// Companion to NearbyShareModal: that one starts with a peer already picked (the ShareView drop strip)
// and local File bytes to send. This one starts with a remote file already known (a cloud/pinned-folder
// key from any file menu app-wide) and needs the user to pick WHICH nearby peer to send it to — a picker
// step, not a destination step, since a nearby peer has no folder tree to browse.
export function NearbyPickerModal({ file, fileName, onClose }: { file: SendableFile; fileName: string; onClose: () => void }) {
  const [peers, setPeers] = useState<NearbyPeer[]>([]);
  const [state, setState] = useState<SendState>('picking');
  const [target, setTarget] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; status: string; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/devices/nearby`);
        const data: { nearby?: NearbyPeer[] } = await res.json();
        if (!cancelled) setPeers(data.nearby ?? []);
      } catch {
        // leave the last-known list — a transient poll blip shouldn't blank the picker mid-pick
      }
    }
    load();
    const interval = setInterval(load, NEARBY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function pick(peer: NearbyPeer) {
    setTarget(peer.name);
    setState('sending');
    const res = await sendFileNearby(file, fileName, peer.id);
    setResult(res);
    setState('done');
  }

  const statusLabel: Record<string, string> = {
    sent: '✓ Sent',
    declined: 'Declined',
    'timed-out': "Didn't respond in time",
    error: 'Failed',
    unreachable: "Couldn't reach that device",
  };

  return (
    <Modal
      title={`Share "${fileName}" Nearby`}
      onClose={onClose}
      footer={state === 'done' ? <button className="btn primary" onClick={onClose}>Done</button> : <button className="btn" onClick={onClose}>Cancel</button>}
    >
      {state === 'picking' && (
        <>
          <div className="empty-state" style={{ padding: '4px 0 10px', fontSize: 12 }}>
            Devices with Nearby Share on, in range right now — no pairing needed.
          </div>
          {peers.length === 0 ? (
            <div className="empty-state">No nearby devices found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {peers.map((p) => (
                <button key={p.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => pick(p)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {state === 'sending' && (
        <div className="empty-state" style={{ padding: '10px 0', fontSize: 12 }}>
          Waiting for {target} to accept…
        </div>
      )}

      {state === 'done' && result && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span>{target}</span>
          <span style={{ color: result.ok ? 'var(--text-secondary)' : 'var(--offline)' }}>
            {result.error ?? statusLabel[result.status] ?? result.status}
          </span>
        </div>
      )}
    </Modal>
  );
}
