import React, { useState } from 'react';
import { BRAND_LOGO_DATA_URI } from '../lib/brandLogo';

const API_BASE = 'http://localhost:4310';

export function OnboardingScreen({ onDone }: { onDone: (username: string) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    await fetch(`${API_BASE}/settings/username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: trimmed }),
    });
    setSaving(false);
    onDone(trimmed);
  }

  return (
    <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <div className="glass-card" style={{ padding: '40px 48px', textAlign: 'center', maxWidth: 340 }}>
        <img src={BRAND_LOGO_DATA_URI} alt="" style={{ width: 40, height: 40 }} />
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 14 }}>Welcome to AllieMinate</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 4, marginBottom: 20 }}>
          What should we call you?
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="select-field"
          style={{ width: '100%', textAlign: 'center', fontSize: 15 }}
          placeholder="Your name"
          autoFocus
        />

        <button className="btn primary" style={{ width: '100%', marginTop: 14 }} onClick={submit} disabled={!name.trim() || saving}>
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
