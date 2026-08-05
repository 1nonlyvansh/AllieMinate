import React, { useEffect, useRef, useState } from 'react';
import type { PairedDeviceInfo, NearbyPeerInfo } from '../lib/types';
import { IconShare, IconMac, IconWindows, IconPhone, IconDevices } from '../icons';
import { ShareModal } from '../components/ShareModal';
import { NearbyShareModal } from '../components/NearbyShareModal';

const API_BASE = 'http://localhost:4310';
const NEARBY_POLL_MS = 4000;

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
  color: 'var(--text-tertiary)', marginBottom: 10,
};

function platformIcon(platform: string, size: number) {
  if (platform === 'darwin') return <IconMac size={size} />;
  if (platform === 'win32') return <IconWindows size={size} />;
  if (platform === 'android' || platform === 'ios') return <IconPhone size={size} />;
  return <IconDevices size={size} />;
}

function DeviceDropStrip({
  devices,
  dragOverId,
  setDragOverId,
  fileInputs,
  onFilesFor,
}: {
  devices: PairedDeviceInfo[];
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
  fileInputs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  onFilesFor: (device: PairedDeviceInfo, files: File[]) => void;
}) {
  return (
    <div className="device-strip">
      {devices.map((d) => (
        <div
          key={d.id}
          className="device-card glass-card"
          style={{ cursor: 'pointer', outline: dragOverId === d.id ? '2px solid var(--accent)' : 'none' }}
          onClick={() => fileInputs.current[d.id]?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverId(d.id);
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverId(null);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) onFilesFor(d, files);
          }}
        >
          <div className="device-icon">{platformIcon(d.platform, 34)}</div>
          <div className="device-name">{d.name}</div>
          <div className="device-meta">Drop a file, or click to browse</div>
          <div className="status-pill online">
            <span className="status-dot online" /> Online
          </div>
          <input
            ref={(el) => { fileInputs.current[d.id] = el; }}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onFilesFor(d, files);
              e.target.value = '';
            }}
          />
        </div>
      ))}
    </div>
  );
}

function NearbyDropStrip({
  peers,
  dragOverId,
  setDragOverId,
  fileInputs,
  onFilesFor,
}: {
  peers: NearbyPeerInfo[];
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
  fileInputs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  onFilesFor: (peer: NearbyPeerInfo, files: File[]) => void;
}) {
  return (
    <div className="device-strip">
      {peers.map((p) => (
        <div
          key={p.id}
          className="device-card glass-card"
          style={{ cursor: 'pointer', outline: dragOverId === p.id ? '2px solid var(--accent)' : 'none' }}
          onClick={() => fileInputs.current[p.id]?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverId(p.id);
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverId(null);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) onFilesFor(p, files);
          }}
        >
          <div className="device-icon">{platformIcon(p.platform, 34)}</div>
          <div className="device-name">{p.name}</div>
          <div className="device-meta">Drop a file, or click to browse</div>
          <div className="status-pill online">
            <span className="status-dot online" /> Nearby
          </div>
          <input
            ref={(el) => { fileInputs.current[p.id] = el; }}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onFilesFor(p, files);
              e.target.value = '';
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function ShareView() {
  const [paired, setPaired] = useState<PairedDeviceInfo[]>([]);
  const [nearby, setNearby] = useState<NearbyPeerInfo[]>([]);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ device: PairedDeviceInfo; files: File[] } | null>(null);
  const [nearbyPending, setNearbyPending] = useState<{ peer: NearbyPeerInfo; files: File[] } | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((res) => res.json())
      .then((data) => setPaired(data.paired ?? []))
      .catch(() => {});
  }, []);

  // Nearby peers come and go live as devices join/leave the LAN or flip their toggle — worth a short poll
  // rather than a one-time fetch, unlike the paired list which only changes on explicit pair/unpair.
  useEffect(() => {
    function loadNearby() {
      fetch(`${API_BASE}/devices/nearby`)
        .then((res) => res.json())
        .then((data) => setNearby(data.nearby ?? []))
        .catch(() => {});
    }
    loadNearby();
    const interval = setInterval(loadNearby, NEARBY_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const online = paired.filter((d) => d.online);

  function onFilesFor(device: PairedDeviceInfo, files: File[]) {
    setPending({ device, files });
  }

  function onNearbyFilesFor(peer: NearbyPeerInfo, files: File[]) {
    setNearbyPending({ peer, files });
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>Share</h1>
          <p>Drag a file onto an online device to send it straight across</p>
        </div>
      </div>

      {online.length === 0 && nearby.length === 0 && (
        <div className="glass-card empty-state">
          <IconShare size={26} />
          <div style={{ marginTop: 10 }}>
            No paired devices are online and nothing's nearby right now. Pair a device from the Devices tab, or turn on Nearby Share on another AllieMinate device on this WiFi.
          </div>
        </div>
      )}

      {online.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Paired Devices</div>
          <DeviceDropStrip devices={online} dragOverId={dragOverId} setDragOverId={setDragOverId} fileInputs={fileInputs} onFilesFor={onFilesFor} />
        </>
      )}

      {nearby.length > 0 && (
        <>
          <div style={{ ...sectionLabelStyle, marginTop: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconDevices size={13} /> Nearby Share
          </div>
          <NearbyDropStrip peers={nearby} dragOverId={dragOverId} setDragOverId={setDragOverId} fileInputs={fileInputs} onFilesFor={onNearbyFilesFor} />
        </>
      )}

      {pending && (
        <ShareModal device={pending.device} files={pending.files} onClose={() => setPending(null)} />
      )}
      {nearbyPending && (
        <NearbyShareModal peer={nearbyPending.peer} files={nearbyPending.files} onClose={() => setNearbyPending(null)} />
      )}
    </section>
  );
}
