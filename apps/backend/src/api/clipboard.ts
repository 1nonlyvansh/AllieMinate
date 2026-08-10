import type { FastifyInstance } from 'fastify';
import { loadPairedDevices } from '../pairing';
import { getDeviceIdentity } from '../device';
import { emitSyncEvent } from '../events';

// Universal Clipboard — text-only, best-effort, no history. A copy on any device with the toggle on
// relays to every OTHER paired device that also has it on; the renderer owns the actual OS clipboard
// read/write (via the standard Web Clipboard API) since this backend has no Electron API access of its
// own (it runs as a plain Node child process — see device.ts's own comment on that constraint). This
// route is just the relay: receive a push from a peer, hand it to the renderer over the same WebSocket
// 'sync event' channel everything else already uses, and fan it further out to every OTHER paired device
// (not the one that just sent it) that also has the toggle on.
export function registerClipboardRoutes(app: FastifyInstance): void {
  // FROM a peer, TO this device — hand it to the renderer to actually write into the OS clipboard.
  app.post<{ Body: { text: string; from: string } }>('/clipboard/push', async (req, reply) => {
    const { text, from } = req.body ?? {};
    if (typeof text !== 'string' || !text) return reply.code(400).send({ error: 'missing text' });

    emitSyncEvent({ type: 'clipboard-updated', folderId: 'clipboard', payload: { text, from: from ?? 'a paired device' } });
    return { ok: true };
  });

  // FROM this device's own renderer (it just detected a local copy), fanning OUT to every paired peer —
  // loopback-only, the renderer calls this on itself, never a peer.
  app.post<{ Body: { text: string } }>('/clipboard/broadcast', async (req, reply) => {
    const { text } = req.body ?? {};
    if (typeof text !== 'string' || !text) return reply.code(400).send({ error: 'missing text' });
    console.error(`[clipboard] broadcast received: "${text.slice(0, 40)}"`);
    await relayClipboardToPeers(text);
    return { ok: true };
  });
}

// Called by the renderer (via a local IPC-exposed function, see main/index.ts) whenever ITS OWN OS
// clipboard changes — fans the new text out to every paired Mac/Windows device with Universal Clipboard
// enabled. Android peers get the exact same push (their LocalHttpServer registers the identical
// /clipboard/push route); this one function covers every peer platform, no branching needed.
export async function relayClipboardToPeers(text: string): Promise<void> {
  const me = getDeviceIdentity();
  const peers = loadPairedDevices().filter((d) => d.universalClipboardEnabled === true);
  await Promise.all(
    peers.map(async (peer) => {
      try {
        const res = await fetch(`http://${peer.host}/clipboard/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${peer.token}` },
          body: JSON.stringify({ text, from: me.name }),
        });
        if (!res.ok) console.error(`[clipboard] push to ${peer.name} (${peer.host}) returned ${res.status}`);
      } catch (err) {
        console.error(`[clipboard] push to ${peer.name} (${peer.host}) failed:`, err);
      }
    }),
  );
}
