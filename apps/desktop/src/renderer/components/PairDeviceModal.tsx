import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

const API_BASE = 'http://localhost:4310';
const CODE_TTL_SECONDS = 5 * 60;

export function PairDeviceModal({
  onClose,
  onPaired,
}: {
  onClose: () => void;
  onPaired: () => void;
}) {
  const [mode, setMode] = useState<'show' | 'connect'>('show');
  const [myCode, setMyCode] = useState<string | null>(null);
  const [myAddress, setMyAddress] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTicking() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function showCode() {
    setMode('show');
    setCodeError(null);
    setCodeBusy(true);
    stopTicking();
    try {
      const res = await fetch(`${API_BASE}/pair/start`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `server returned ${res.status}`);
      if (!data.code) throw new Error('no code returned');
      setMyCode(data.code);
      setMyAddress(data.lanAddress && data.port ? `${data.lanAddress}:${data.port}` : null);
      setSecondsLeft(CODE_TTL_SECONDS);
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            stopTicking();
            showCode();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      setMyCode(null);
      setCodeError(err instanceof Error ? err.message : "couldn't reach AllieMinate backend");
    } finally {
      setCodeBusy(false);
    }
  }

  useEffect(() => stopTicking, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/pair/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'pairing failed');
      setPaired(data.device?.name ?? host);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <Modal title="Pair a Device" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn small${mode === 'show' ? ' primary' : ''}`} onClick={showCode}>Show my code</button>
        <button className={`btn small${mode === 'connect' ? ' primary' : ''}`} onClick={() => { stopTicking(); setMode('connect'); }}>Enter their code</button>
      </div>

      {mode === 'show' && (
        <div style={{ textAlign: 'center' }}>
          {!myCode && !codeBusy && !codeError && (
            <div className="empty-state">Click "Show my code" to generate a pairing code for the other device.</div>
          )}
          {codeBusy && !myCode && <div className="empty-state">Generating code…</div>}
          {codeError && (
            <div style={{ color: 'var(--offline)', fontSize: 12.5 }}>
              {codeError}
              <div style={{ marginTop: 8 }}>
                <button className="btn small" onClick={showCode}>Try again</button>
              </div>
            </div>
          )}
          {myCode && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 4, margin: '10px 0' }}>{myCode}</div>
                <button className="btn small" disabled={codeBusy} onClick={showCode} title="Generate a new code">
                  {codeBusy ? '…' : '↻'}
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                On the other device, choose "Enter their code" and type:
              </div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, marginTop: 6 }}>
                {myAddress ?? 'no LAN address found — check your WiFi connection'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
                Expires in {mm}:{ss}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'connect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>Device address (IP:port)</div>
            <input className="select-field" style={{ width: '100%' }} placeholder="192.168.1.23:4310" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>Pairing code</div>
            <input className="select-field" style={{ width: '100%' }} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="btn primary" disabled={busy || !host || !code} onClick={connect}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          {paired && <div style={{ color: 'var(--online)', fontSize: 12.5 }}>Paired with {paired}.</div>}
          {error && <div style={{ color: 'var(--offline)', fontSize: 12.5 }}>{error}</div>}
        </div>
      )}
    </Modal>
  );
}
