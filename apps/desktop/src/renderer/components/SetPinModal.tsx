import React, { useState } from 'react';
import { Modal } from './Modal';
import { biometricName } from '../lib/platformLabels';

export function SetPinModal({
  onClose,
  onSet,
}: {
  onClose: () => void;
  onSet: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pin.length < 4 || pin.length > 8 || !/^\d+$/.test(pin)) {
      setError('PIN must be 4–8 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSet(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Set a PIN"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !pin || !confirmPin} onClick={submit}>
            {busy ? 'Saving…' : 'Enable App Lock'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>
        This PIN unlocks AllieMinate when {biometricName} isn't available. It's stored encrypted via your device's secure storage.
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>PIN (4–8 digits)</div>
        <input
          type="password"
          inputMode="numeric"
          className="select-field"
          style={{ width: '100%' }}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>Confirm PIN</div>
        <input
          type="password"
          inputMode="numeric"
          className="select-field"
          style={{ width: '100%' }}
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      {error && <div style={{ color: 'var(--offline)', fontSize: 12 }}>{error}</div>}
    </Modal>
  );
}
