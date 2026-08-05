import React, { useEffect, useRef, useState } from 'react';
import { IconLock } from '../icons';

const API_BASE = 'http://localhost:4310';
const UNLOCK_POLL_MS = 1500;
// client-side cap matching the backend's own request TTL (unlockApproval.ts) — if nobody's answered by
// then the request has expired on every peer anyway, no point polling past it.
const UNLOCK_TIMEOUT_MS = 90_000;

type PhoneApproveState = 'idle' | 'asking' | 'waiting' | 'declined' | 'timed-out' | 'error';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canTouchID, setCanTouchID] = useState(false);
  const [tryingTouchID, setTryingTouchID] = useState(false);
  const [hasPairedDevices, setHasPairedDevices] = useState(false);
  // null = still checking. Distinct from hasPairedDevices — a device can be paired but not currently
  // reachable (phone off, different network, app killed), and "Approve on Phone" broadcasting to a device
  // that's paired-but-offline just silently times out after 90s with no useful feedback. Checking online
  // state upfront means the button either works or says so immediately, instead of looking broken.
  const [phoneOnline, setPhoneOnline] = useState<boolean | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneState, setPhoneState] = useState<PhoneApproveState>('idle');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function checkPhoneOnline() {
    setCheckingPhone(true);
    try {
      const res = await fetch(`${API_BASE}/devices`);
      const data: { paired?: { online?: boolean }[] } = await res.json();
      const paired = data.paired ?? [];
      setHasPairedDevices(paired.length > 0);
      setPhoneOnline(paired.some((d) => d.online === true));
    } catch {
      setPhoneOnline(false);
    } finally {
      setCheckingPhone(false);
    }
  }

  useEffect(() => {
    window.security.canTouchID().then((can) => {
      setCanTouchID(can);
      if (can) attemptTouchID();
    });
    checkPhoneOnline();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  async function askPhone() {
    setPhoneState('asking');
    setPhoneError(null);
    try {
      const res = await fetch(`${API_BASE}/unlock/broadcast`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error || !data.requestId) throw new Error(data.error ?? 'could not reach any paired device');
      setPhoneState('waiting');
      pollUnlockStatus(data.requestId, Date.now());
    } catch (err) {
      setPhoneState('error');
      setPhoneError(err instanceof Error ? err.message : String(err));
    }
  }

  function pollUnlockStatus(requestId: string, startedAt: number) {
    pollTimer.current = setTimeout(async () => {
      if (Date.now() - startedAt > UNLOCK_TIMEOUT_MS) {
        setPhoneState('timed-out');
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/unlock/status/${requestId}`);
        const data = await res.json();
        if (data.status === 'accepted') {
          onUnlock();
          return;
        }
        if (data.status === 'declined') {
          setPhoneState('declined');
          return;
        }
        if (data.status === 'expired' || !res.ok) {
          setPhoneState('timed-out');
          return;
        }
      } catch {
        // transient — keep polling, don't bail on one dropped request
      }
      pollUnlockStatus(requestId, startedAt);
    }, UNLOCK_POLL_MS);
  }

  async function attemptTouchID() {
    setTryingTouchID(true);
    setError(null);
    const ok = await window.security.tryTouchID();
    setTryingTouchID(false);
    if (ok) onUnlock();
  }

  async function submitPin() {
    const ok = await window.security.verifyPin(pin);
    if (ok) {
      onUnlock();
    } else {
      setError('Wrong PIN');
      setPin('');
    }
  }

  return (
    <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <div className="glass-card" style={{ padding: '40px 48px', textAlign: 'center', maxWidth: 320 }}>
        <IconLock size={30} />
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 14 }}>AllieMinate is locked</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 4, marginBottom: 20 }}>
          {tryingTouchID ? 'Waiting for Touch ID…' : 'Enter your PIN to continue'}
        </div>

        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitPin()}
          className="select-field"
          style={{ width: '100%', textAlign: 'center', fontSize: 18, letterSpacing: 4 }}
          autoFocus
        />
        {error && <div style={{ color: 'var(--offline)', fontSize: 12, marginTop: 8 }}>{error}</div>}

        <button className="btn primary" style={{ width: '100%', marginTop: 14 }} onClick={submitPin} disabled={!pin}>
          Unlock
        </button>

        {canTouchID && (
          <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={attemptTouchID} disabled={tryingTouchID}>
            Use Touch ID
          </button>
        )}

        {hasPairedDevices && (
          <>
            {phoneOnline === false && phoneState === 'idle' && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
                Phone not Connected
                <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={checkPhoneOnline} disabled={checkingPhone}>
                  {checkingPhone ? 'Checking…' : 'Refresh'}
                </button>
              </div>
            )}
            {phoneOnline === true && (phoneState === 'idle' || phoneState === 'asking') && (
              <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={askPhone} disabled={phoneState === 'asking'}>
                {phoneState === 'asking' ? 'Asking your phone…' : 'Approve on Phone'}
              </button>
            )}
            {phoneState === 'waiting' && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>
                Waiting for approval on your phone…
                <button
                  className="btn"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={() => {
                    if (pollTimer.current) clearTimeout(pollTimer.current);
                    setPhoneState('idle');
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {phoneState === 'declined' && (
              <div style={{ color: 'var(--offline)', fontSize: 12, marginTop: 10 }}>
                Declined on your phone.{' '}
                <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={() => setPhoneState('idle')}>
                  Try again
                </button>
              </div>
            )}
            {(phoneState === 'timed-out' || phoneState === 'error') && (
              <div style={{ color: 'var(--offline)', fontSize: 12, marginTop: 10 }}>
                {phoneState === 'error' ? (phoneError ?? 'Could not reach your phone') : "No response — didn't reach your phone in time"}.{' '}
                <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={() => setPhoneState('idle')}>
                  Try again
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
