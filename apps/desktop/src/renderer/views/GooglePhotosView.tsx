import React, { useEffect, useRef, useState } from 'react';
import { IconImage } from '../icons';
import { DropdownMenu } from '../components/DropdownMenu';
import { usePairedDevices, buildSendMenuItems, SendableFile } from '../lib/sendActions';
import { NearbyPickerModal } from '../components/NearbyPickerModal';

const API_BASE = 'http://localhost:4310';

interface PhotosAccountInfo {
  accountId: string;
  label: string;
}

interface MediaItem {
  id: string;
  baseUrl: string;
  filename: string;
  isVideo: boolean;
  creationTime?: string;
}

type PickState = 'idle' | 'waiting' | 'error';

export function GooglePhotosView() {
  const [accounts, setAccounts] = useState<PhotosAccountInfo[]>([]);
  const [accountFilter, setAccountFilter] = useState('all');
  const [itemsByAccount, setItemsByAccount] = useState<Record<string, MediaItem[]>>({});
  const [pickState, setPickState] = useState<Record<string, PickState>>({});
  const [pickError, setPickError] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [staleItems, setStaleItems] = useState<Record<string, boolean>>({});
  const [nearbyTarget, setNearbyTarget] = useState<{ file: SendableFile; name: string } | null>(null);
  const devices = usePairedDevices();
  const pollTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch(`${API_BASE}/photos/accounts`)
      .then((res) => res.json())
      .then((data) => {
        const accts: PhotosAccountInfo[] = data.accounts ?? [];
        setAccounts(accts);
        // re-hydrate previously picked items — the backend persists them, so leaving this tab (or
        // restarting the app) shouldn't lose what was already picked.
        Promise.all(
          accts.map((a) =>
            fetch(`${API_BASE}/photos/${a.accountId}/media`)
              .then((res) => res.json())
              .then((d) => [a.accountId, d.items ?? []] as const)
              .catch(() => [a.accountId, []] as const),
          ),
        ).then((results) => {
          setItemsByAccount((prev) => ({ ...prev, ...Object.fromEntries(results) }));
        });
      })
      .catch(() => setError('Backend unreachable'));

    return () => {
      Object.values(pollTimers.current).forEach(clearTimeout);
    };
  }, []);

  async function startPicking(accountId: string) {
    setPickState((s) => ({ ...s, [accountId]: 'waiting' }));
    setPickError((e) => ({ ...e, [accountId]: '' }));

    try {
      const res = await fetch(`${API_BASE}/photos/${accountId}/picker/session`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed to start picker session');

      window.open(data.pickerUri);
      poll(accountId, data.sessionId, data.pollIntervalMs ?? 2000);
    } catch (err) {
      setPickState((s) => ({ ...s, [accountId]: 'error' }));
      setPickError((e) => ({ ...e, [accountId]: err instanceof Error ? err.message : String(err) }));
    }
  }

  function poll(accountId: string, sessionId: string, intervalMs: number) {
    pollTimers.current[accountId] = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/photos/${accountId}/picker/session/${sessionId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'failed to poll picker session');

        if (data.mediaItemsSet) {
          const itemsRes = await fetch(`${API_BASE}/photos/${accountId}/picker/session/${sessionId}/items`);
          const itemsData = await itemsRes.json();
          if (!itemsRes.ok) throw new Error(itemsData.error ?? 'failed to fetch picked items');
          setItemsByAccount((prev) => ({ ...prev, [accountId]: itemsData.items ?? [] }));
          setPickState((s) => ({ ...s, [accountId]: 'idle' }));
        } else {
          poll(accountId, sessionId, intervalMs);
        }
      } catch (err) {
        setPickState((s) => ({ ...s, [accountId]: 'error' }));
        setPickError((e) => ({ ...e, [accountId]: err instanceof Error ? err.message : String(err) }));
      }
    }, intervalMs);
  }

  function downloadItem(item: MediaItem & { accountId: string }) {
    const url = `${API_BASE}/photos/${item.accountId}/thumbnail?url=${encodeURIComponent(item.baseUrl)}&download=1&filename=${encodeURIComponent(item.filename)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    a.click();
  }

  async function removeItem(item: MediaItem & { accountId: string }) {
    const res = await fetch(`${API_BASE}/photos/${item.accountId}/media/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) setItemsByAccount((prev) => ({ ...prev, [item.accountId]: data.items ?? [] }));
  }

  async function openInApp(item: MediaItem & { accountId: string }) {
    await fetch(`${API_BASE}/photos/${item.accountId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: item.baseUrl, filename: item.filename }),
    });
  }

  async function copyItem(item: MediaItem & { accountId: string }) {
    try {
      const url = `${API_BASE}/photos/${item.accountId}/thumbnail?url=${encodeURIComponent(item.baseUrl)}&download=1&filename=${encodeURIComponent(item.filename)}`;
      const res = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch (err) {
      window.alert("Couldn't copy this — " + (err instanceof Error ? err.message : String(err)));
    }
  }

  function handleThumbError(key: string) {
    setStaleItems((s) => ({ ...s, [key]: true }));
  }

  const visibleAccounts = accountFilter === 'all' ? accounts : accounts.filter((a) => a.accountId === accountFilter);
  const items = visibleAccounts.flatMap((a) => (itemsByAccount[a.accountId] ?? []).map((item) => ({ ...item, accountId: a.accountId })));
  items.sort((a, b) => (b.creationTime ?? '').localeCompare(a.creationTime ?? ''));

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>Google Photos</h1>
          <p>Pick photos and videos from your linked Google accounts to view them here</p>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="toolbar-row">
          <select className="select-field" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="all">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>{a.label}</option>
            ))}
          </select>
        </div>
      )}

      {accounts.length === 0 && !error && (
        <div className="glass-card empty-state">
          <IconImage size={26} />
          <div style={{ marginTop: 10 }}>No Google Photos accounts linked yet — add one from Settings.</div>
        </div>
      )}

      {error && <div className="glass-card empty-state" style={{ color: 'var(--offline)' }}>{error}</div>}

      {accounts.length > 0 && (
        <div className="glass-card" style={{ padding: '14px 16px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {visibleAccounts.map((a) => {
            const state = pickState[a.accountId] ?? 'idle';
            return (
              <button
                key={a.accountId}
                className="btn-secondary"
                disabled={state === 'waiting'}
                onClick={() => startPicking(a.accountId)}
              >
                {state === 'waiting' ? `Waiting on ${a.label}…` : `Pick photos from ${a.label}`}
              </button>
            );
          })}
        </div>
      )}

      {Object.entries(pickError).map(([accountId, msg]) => {
        if (!msg) return null;
        if (accountFilter !== 'all' && accountFilter !== accountId) return null;
        const label = accounts.find((a) => a.accountId === accountId)?.label ?? accountId;
        return (
          <div key={accountId} className="glass-card empty-state" style={{ color: 'var(--offline)', textAlign: 'left', padding: '10px 16px', marginBottom: 10 }}>
            {label}: {msg}
          </div>
        );
      })}

      {items.length > 0 && (
        <div className="folder-grid">
          {items.map((item) => (
            <div key={item.accountId + item.id} className="folder-card glass-card">
              <DropdownMenu
                items={[
                  { label: 'Open In App', onClick: () => openInApp(item) },
                  { label: 'Download', onClick: () => downloadItem(item) },
                  { label: 'Copy', onClick: () => copyItem(item) },
                  { divider: true },
                  ...buildSendMenuItems(
                    devices,
                    { kind: 'photo', accountId: item.accountId, baseUrl: item.baseUrl },
                    item.filename,
                    () => setNearbyTarget({ file: { kind: 'photo', accountId: item.accountId, baseUrl: item.baseUrl }, name: item.filename }),
                  ),
                  { divider: true },
                  { label: 'Remove', danger: true, onClick: () => removeItem(item) },
                ]}
              />
              <div className="thumb-wrap">
                {staleItems[item.accountId + item.id] ? (
                  <span className="thumb-fallback type-image">{item.isVideo ? 'Video' : 'Photo'} expired — re-pick</span>
                ) : (
                  <img
                    src={`${API_BASE}/photos/${item.accountId}/thumbnail?url=${encodeURIComponent(item.baseUrl)}&w=300&h=300`}
                    className="thumb-img"
                    alt=""
                    onError={() => handleThumbError(item.accountId + item.id)}
                  />
                )}
              </div>
              <div className="folder-name">{item.filename}</div>
              <div className="folder-meta">{item.isVideo ? 'Video' : 'Photo'}</div>
            </div>
          ))}
        </div>
      )}

      {accounts.length > 0 && items.length === 0 && (
        <div className="glass-card empty-state">Nothing picked yet — hit "Pick photos" above to select some in the Google Photos picker.</div>
      )}

      {nearbyTarget && (
        <NearbyPickerModal file={nearbyTarget.file} fileName={nearbyTarget.name} onClose={() => setNearbyTarget(null)} />
      )}
    </section>
  );
}
