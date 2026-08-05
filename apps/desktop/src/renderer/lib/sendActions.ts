import { useEffect, useState } from 'react';
import type { MenuItem } from '../components/DropdownMenu';

const API_BASE = 'http://localhost:4310';
const DEVICE_POLL_MS = 15000;

// A cloud/pinned-folder file resolves bytes via a StorageBackend (folderId or providerId + key); a Google
// Photos item has no such backend, it lives behind the Picker API's baseUrl instead — same shape as the
// dedicated /photos/:id/send-to-device and /photos/:id/send-nearby routes need.
export type SendableFile =
  | { kind: 'cloud'; folderId?: string; providerId?: string; key: string; mimeType?: string }
  | { kind: 'photo'; accountId: string; baseUrl: string }
  | { kind: 'local'; path: string; mimeType?: string };

export interface PairedDeviceOption {
  id: string;
  name: string;
}

/** Online paired devices, for the "Send to <Device>" menu items every file view offers — polled rather
 * than fetched once since a device can come online/go offline while the menu just sits there unopened. */
export function usePairedDevices(): PairedDeviceOption[] {
  const [devices, setDevices] = useState<PairedDeviceOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/devices`);
        const data: { paired?: { id: string; name: string; online: boolean }[] } = await res.json();
        if (cancelled) return;
        setDevices((data.paired ?? []).filter((d) => d.online).map((d) => ({ id: d.id, name: d.name })));
      } catch {
        // leave the last-known list in place — a transient poll failure shouldn't blank the menu
      }
    }
    load();
    const interval = setInterval(load, DEVICE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return devices;
}

/** One-click send — drops into the target device's first folder (its "Received on Phone" bucket for
 * Android, same convention the tray's drag-drop Send-to-Device flow already uses). */
export async function sendFileToDevice(file: SendableFile, fileName: string, deviceId: string, deviceName: string): Promise<void> {
  const url = file.kind === 'photo' ? `${API_BASE}/photos/${file.accountId}/send-to-device` : `${API_BASE}/files/send-to-device`;
  const body =
    file.kind === 'photo' ? { baseUrl: file.baseUrl, filename: fileName, deviceId } :
    file.kind === 'local' ? { localPath: file.path, mimeType: file.mimeType, deviceId } :
    { ...file, deviceId };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'send failed');
  } catch (err) {
    window.alert(`Couldn't send this file to ${deviceName} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function sendFileNearby(file: SendableFile, fileName: string, peerId: string): Promise<{ ok: boolean; status: string; error?: string }> {
  const url = file.kind === 'photo' ? `${API_BASE}/photos/${file.accountId}/send-nearby` : `${API_BASE}/files/send-nearby`;
  const body =
    file.kind === 'photo' ? { baseUrl: file.baseUrl, filename: fileName, peerId } :
    file.kind === 'local' ? { localPath: file.path, mimeType: file.mimeType, peerId } :
    { ...file, peerId };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return { ok: false, status: 'error', error: data.error ?? 'send failed' };
    return data;
  } catch (err) {
    return { ok: false, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Appended to every per-file dropdown menu app-wide: one flat "Send to <Device>" item per online paired
 * device (spec calls for one-click, no folder picker), plus a single "Share to Nearby" item that opens a
 * picker for LAN-discovered unpaired devices (those aren't a fixed list, so a modal makes more sense than
 * more flat items that go stale the moment the menu was already open). */
export function buildSendMenuItems(devices: PairedDeviceOption[], file: SendableFile, fileName: string, onShareNearby: () => void): MenuItem[] {
  return [
    ...devices.map((d): MenuItem => ({ label: `Send to ${d.name}`, onClick: () => sendFileToDevice(file, fileName, d.id, d.name) })),
    { label: 'Share to Nearby', onClick: onShareNearby },
  ];
}
