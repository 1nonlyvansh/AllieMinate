import type { ClipboardFileItem } from './types';

const API_BASE = 'http://localhost:4310';

/** Paste one clipboard item into a destination cloud folder — branches on whether the item came from a
 * paired device (RemoteBrowser's Copy/Cut) or another cloud folder (the pre-existing Files/Pinned
 * Folders/Cloud Services paste flow). A device-sourced "cut" is copy-then-delete-on-phone since there's
 * no atomic cross-system move between a phone and a cloud provider. */
export async function pasteClipboardItem(
  item: ClipboardFileItem,
  dest: { folderId?: string; provider: string },
  action: 'copy' | 'cut',
): Promise<void> {
  if (item.deviceId) {
    const res = await fetch(`${API_BASE}/devices/${item.deviceId}/folders/${item.folderId}/copy-to-cloud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: item.path, destProviderId: dest.provider, ...(dest.folderId ? { destFolderId: dest.folderId } : {}) }),
    });
    if (!res.ok) throw new Error('copy from device failed');
    if (action === 'cut') {
      await fetch(`${API_BASE}/devices/${item.deviceId}/folders/${item.folderId}/file?key=${encodeURIComponent(item.path)}`, {
        method: 'DELETE',
      });
    }
    return;
  }

  if (!dest.folderId) throw new Error('missing destination folder');
  const endpoint = action === 'copy' ? 'copy' : 'move';
  const res = await fetch(`${API_BASE}/files/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceFolderId: item.folderId, key: item.path, destFolderId: dest.folderId, destName: item.name }),
  });
  if (!res.ok) throw new Error('paste failed');
}
