import React, { useState } from 'react';
import { Modal } from './Modal';

const API_BASE = 'http://localhost:4310';

export function ConnectProviderModal({
  providerId,
  providerName,
  kind,
  onClose,
  onConnected,
}: {
  providerId: string;
  providerName: string;
  kind: 's3' | 'mega';
  onClose: () => void;
  onConnected: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>(
    kind === 's3'
      ? { endpoint: '', region: '', bucket: '', accessKeyId: '', secretAccessKey: '' }
      : { email: '', password: '' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const url = kind === 's3' ? `${API_BASE}/providers/${providerId}/connect/s3` : `${API_BASE}/providers/mega/connect`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'connection failed');
      onConnected();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const s3Fields: [string, string][] = [
    ['endpoint', 'Endpoint (e.g. s3.eu-central-003.backblazeb2.com)'],
    ['region', 'Region'],
    ['bucket', 'Bucket name'],
    ['accessKeyId', 'Access Key ID'],
    ['secretAccessKey', 'Secret Access Key'],
  ];
  const megaFields: [string, string][] = [
    ['email', 'Email'],
    ['password', 'Password'],
  ];

  // B2/iDrive e2 are raw S3-compatible object storage, not an app with its own "Sign in with X" page —
  // there's no OAuth flow to redirect to, these five values are the actual credentials, generated once
  // from each provider's own web console and pasted in here. This link is the single biggest point of
  // confusion this form gets, so it's worth surfacing directly rather than assuming the user already knows
  // where to find them.
  const HELP_LINKS: Partial<Record<string, { label: string; url: string }>> = {
    b2: { label: 'Get these from your Backblaze account → App Keys', url: 'https://secure.backblaze.com/app_keys.htm' },
    'idrive-e2': { label: 'Get these from your IDrive e2 dashboard → Access Keys', url: 'https://www.idrive.com/e2/' },
  };
  const helpLink = kind === 's3' ? HELP_LINKS[providerId] : undefined;

  return (
    <Modal
      title={`Connect ${providerName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </>
      }
    >
      {helpLink && (
        <div style={{ fontSize: 11.5, marginBottom: 10 }}>
          {kind === 's3' ? 'No sign-in page for this one — ' : ''}
          <a href={helpLink.url} target="_blank" rel="noreferrer">{helpLink.label}</a>, then paste them below.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(kind === 's3' ? s3Fields : megaFields).map(([key, label]) => (
          <div key={key}>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</div>
            <input
              className="select-field"
              style={{ width: '100%' }}
              type={key === 'password' || key === 'secretAccessKey' ? 'password' : 'text'}
              value={fields[key]}
              onChange={set(key)}
            />
          </div>
        ))}
      </div>
      {error && <div style={{ color: 'var(--offline)', fontSize: 11.5, marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}
