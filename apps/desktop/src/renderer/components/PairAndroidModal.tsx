import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Modal } from './Modal';
import { deviceNounLower } from '../lib/platformLabels';

const API_BASE = 'http://localhost:4310';
const CODE_TTL_SECONDS = 5 * 60;
const CONNECTED_POLL_MS = 2000;

type Tab = 'qr' | 'usb';
type Connected = { name: string } | null;

async function pairedDeviceIds(): Promise<Set<string>> {
  try {
    const res = await fetch(`${API_BASE}/devices`);
    const data = await res.json();
    return new Set((data.paired ?? []).map((d: { id: string }) => d.id));
  } catch {
    return new Set();
  }
}

/** Android-only pairing, single modal with two tabs (matches O+ Connect's layout) — "Scan QR Code" for
 * LAN and "Connect via USB" as the no-WiFi fallback. USB skips the QR entirely: once the adb tunnel is
 * up, the desktop launches AllieMinate on the phone directly via a deep link carrying the pairing code
 * (adb.ts's launchPairDeepLink), same as O+ Connect's "just confirm on your phone" — the one-time USB
 * debugging authorization is the only prompt, not a per-pairing QR scan. Both tabs poll /devices against
 * a baseline snapshot taken when the modal opened, so a newly-appeared device flips the view to
 * "Connected" instead of leaving a stale QR code on screen after the phone already paired. */
export function PairAndroidModal({ onClose, onPaired }: { onClose: () => void; onPaired: () => void }) {
  const [tab, setTab] = useState<Tab>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [usbConnecting, setUsbConnecting] = useState(false);
  const [waitingForPhone, setWaitingForPhone] = useState(false);
  const [connected, setConnected] = useState<Connected>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baselineRef = useRef<Set<string>>(new Set());
  const watchRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTicking() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function stopWatching() {
    if (watchRef.current) {
      clearInterval(watchRef.current);
      watchRef.current = null;
    }
  }

  function watchForConnection(code?: string) {
    stopWatching();
    watchRef.current = setInterval(async () => {
      const res = await fetch(`${API_BASE}/devices`).then((r) => r.json()).catch(() => null);
      const paired: { id: string; name: string }[] = res?.paired ?? [];
      const fresh = paired.find((d) => !baselineRef.current.has(d.id));
      if (fresh) {
        stopWatching();
        stopTicking();
        setConnected({ name: fresh.name });
        onPaired();
        return;
      }

      if (code) {
        const statusRes = await fetch(`${API_BASE}/pair/status?code=${code}`).then((r) => r.json()).catch(() => null);
        if (statusRes?.status === 'rejected') {
          stopWatching();
          stopTicking();
          setWaitingForPhone(false);
          setError('Device rejected the request. Plug it in again to try again.');
        }
      }
    }, CONNECTED_POLL_MS);
  }

  async function generate(viaUsb: boolean) {
    setError(null);
    setBusy(true);
    setQrDataUrl(null);
    stopTicking();
    try {
      // a hung /pair/start (backend restarting, port contention right after a rebuild) used to leave
      // `busy` true forever with no error and no QR — nothing to look at and nothing to retry either.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/pair/start`, { method: 'POST', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `server returned ${res.status}`);
      if (!data.code) throw new Error('no pairing code returned');
      if (!viaUsb && (!data.lanAddress || !data.port)) throw new Error('no LAN address found — check your WiFi connection');

      const host = viaUsb ? `localhost:${data.port ?? 4310}` : `${data.lanAddress}:${data.port}`;
      const payload = JSON.stringify({ host, code: data.code });
      const url = await QRCode.toDataURL(payload, { width: 220, margin: 1 });
      setQrDataUrl(url);
      setSecondsLeft(CODE_TTL_SECONDS);
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            stopTicking();
            generate(viaUsb);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
      watchForConnection();
    } catch (err) {
      setQrDataUrl(null);
      const message = err instanceof Error && err.name === 'AbortError' ? "backend didn't respond — is AllieMinate still starting up?" : err instanceof Error ? err.message : "couldn't reach AllieMinate backend";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function connectUsb() {
    setError(null);
    setWaitingForPhone(false);
    setUsbConnecting(true);
    baselineRef.current = await pairedDeviceIds();

    const tunnel = await window.usbPairing.connect();
    if (!tunnel.ok) {
      setUsbConnecting(false);
      setError(tunnel.error ?? 'USB connection failed');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/pair/start`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `server returned ${res.status}`);
      if (!data.code) throw new Error('no pairing code returned');

      const launch = await window.usbPairing.launchPairDeepLink(data.code, data.deviceName ?? deviceNounLower);
      if (!launch.ok) throw new Error(launch.error ?? 'could not open AllieMinate on the phone');

      setWaitingForPhone(true);
      watchForConnection(data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't reach AllieMinate backend");
    } finally {
      setUsbConnecting(false);
    }
  }

  function selectTab(next: Tab) {
    setTab(next);
    setQrDataUrl(null);
    setError(null);
    setConnected(null);
    stopTicking();
    stopWatching();
    if (next === 'qr') {
      pairedDeviceIds().then((ids) => {
        baselineRef.current = ids;
        generate(false);
      });
    }
  }

  useEffect(() => {
    pairedDeviceIds().then((ids) => {
      baselineRef.current = ids;
      generate(false);
    });
    return () => {
      stopTicking();
      stopWatching();
    };
  }, []);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <Modal title="Pair an Android Phone" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--hairline)' }}>
        <button
          className={`btn small${tab === 'qr' ? ' primary' : ''}`}
          style={{ borderRadius: '8px 8px 0 0' }}
          onClick={() => selectTab('qr')}
        >
          Scan QR Code
        </button>
        <button
          className={`btn small${tab === 'usb' ? ' primary' : ''}`}
          style={{ borderRadius: '8px 8px 0 0' }}
          onClick={() => selectTab('usb')}
        >
          Connect via USB
        </button>
      </div>

      {connected ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 32, color: 'var(--online)', marginBottom: 10 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Connected</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{connected.name}</div>
        </div>
      ) : tab === 'qr' ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 14 }}>
            On your phone, open AllieMinate → Devices → Pair with QR Code, then scan this.
          </div>
          {busy && !qrDataUrl && <div className="empty-state">Generating QR code…</div>}
          {error && (
            <div style={{ color: 'var(--offline)', fontSize: 12.5 }}>
              {error}
              <div style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => generate(false)}>Try again</button>
              </div>
            </div>
          )}
          {qrDataUrl && (
            <>
              <img
                src={qrDataUrl}
                alt="Pairing QR code"
                style={{ width: 220, height: 220, borderRadius: 12, background: '#fff', padding: 12 }}
                onError={() => {
                  setQrDataUrl(null);
                  setError("Couldn't render the QR code image.");
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10 }}>
                Expires in {mm}:{ss}
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 14 }}>
            1. Connect your phone to {deviceNounLower} with a USB cable.
            <br />
            2. Tap Connect — AllieMinate opens on your phone and asks you to confirm.
            <br />
            <span style={{ fontSize: 11 }}>(First time only: your phone may also ask you to trust {deviceNounLower} for USB debugging.)</span>
          </div>

          {!usbConnecting && !waitingForPhone && <button className="btn primary" onClick={connectUsb}>Connect</button>}
          {usbConnecting && <div className="empty-state">Connecting…</div>}
          {waitingForPhone && !usbConnecting && !error && (
            <div className="empty-state">Waiting for you to confirm on your phone…</div>
          )}
          {error && (
            <div style={{ color: 'var(--offline)', fontSize: 12.5, marginTop: 10 }}>
              {error}
              <div style={{ marginTop: 8 }}>
                <button className="btn small" onClick={connectUsb}>Try again</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
