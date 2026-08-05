import React, { useEffect, useState } from 'react';
import type { ProviderStorage, StorageProviderId } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import { formatBytes } from '../lib/format';
import { ConnectProviderModal } from '../components/ConnectProviderModal';
import { SetPinModal } from '../components/SetPinModal';
import { RenameModal } from '../components/RenameModal';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { RecordLogModal } from '../components/RecordLogModal';

const API_BASE = 'http://localhost:4310';

const ALL_PROVIDERS: { id: StorageProviderId; name: string; color: string; kind?: 's3' | 'mega' | 'oauth'; pendingNote?: string }[] = [
  { id: 'google-drive', name: 'Google Drive', color: '#4285f4', kind: 'oauth' },
  { id: 'b2', name: 'Backblaze B2', color: '#e2231a', kind: 's3' },
  { id: 'idrive-e2', name: 'IDrive e2', color: '#0f9d58', kind: 's3' },
  { id: 'mega', name: 'MEGA', color: '#d9272e', kind: 'mega' },
  { id: 'pcloud', name: 'pCloud', color: '#17bfea', kind: 'oauth' },
  { id: 'onedrive', name: 'OneDrive', color: '#0078d4', kind: 'oauth' },
];

interface DriveAccountInfo {
  accountId: string;
  label: string;
}

function Toggle({ initial = false }: { initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return <button className={`toggle${on ? ' on' : ''}`} onClick={() => setOn((v) => !v)} />;
}

function AppLockToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    window.security.isEnabled().then(setEnabled);
  }, []);

  async function toggle() {
    if (enabled) {
      if (!window.confirm('Turn off App Lock? Anyone with access to this Mac will be able to open AllieMinate.')) return;
      await window.security.setEnabled(false);
      setEnabled(false);
    } else {
      setShowSetup(true);
    }
  }

  return (
    <>
      <button className={`toggle${enabled ? ' on' : ''}`} onClick={toggle} disabled={enabled === null} />
      {showSetup && (
        <SetPinModal
          onClose={() => setShowSetup(false)}
          onSet={async (pin) => {
            await window.security.setEnabled(true, pin);
            setEnabled(true);
            setShowSetup(false);
          }}
        />
      )}
    </>
  );
}

const BANDWIDTH_OPTIONS: { label: string; bytesPerSec: number | null }[] = [
  { label: 'Unlimited', bytesPerSec: null },
  { label: '10 MB/s', bytesPerSec: 10 * 1024 * 1024 },
  { label: '5 MB/s', bytesPerSec: 5 * 1024 * 1024 },
  { label: '1 MB/s', bytesPerSec: 1 * 1024 * 1024 },
];

function BandwidthLimitSelect() {
  const [bytesPerSec, setBytesPerSec] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/settings/bandwidth-limit`)
      .then((res) => res.json())
      .then((data) => setBytesPerSec(data.bytesPerSec ?? null))
      .catch(() => {});
  }, []);

  async function change(value: string) {
    const next = value === 'unlimited' ? null : Number(value);
    setBytesPerSec(next);
    await fetch(`${API_BASE}/settings/bandwidth-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytesPerSec: next }),
    });
  }

  return (
    <select className="select-field right" value={bytesPerSec === null ? 'unlimited' : String(bytesPerSec)} onChange={(e) => change(e.target.value)}>
      {BANDWIDTH_OPTIONS.map((opt) => (
        <option key={opt.label} value={opt.bytesPerSec === null ? 'unlimited' : opt.bytesPerSec}>{opt.label}</option>
      ))}
    </select>
  );
}

function UsageBar({ usedBytes, totalBytes }: { usedBytes: number; totalBytes: number }) {
  if (!totalBytes) return null;
  const pct = Math.min(100, (usedBytes / totalBytes) * 100);
  const color = pct >= 80 ? '#ff453a' : pct >= 50 ? '#ffd60a' : '#34c759';
  return (
    <div style={{ height: 4, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${Math.max(2, pct)}%`, background: color, transition: 'width 0.3s ease' }} />
    </div>
  );
}

function LaunchAtLoginToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    window.launchAtLogin.isEnabled().then(setEnabled);
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    await window.launchAtLogin.setEnabled(next);
  }

  return <button className={`toggle${enabled ? ' on' : ''}`} onClick={toggle} disabled={enabled === null} />;
}

function UsernameRow() {
  const [username, setUsername] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  function refresh() {
    fetch(`${API_BASE}/settings/username`)
      .then((res) => res.json())
      .then((data) => setUsername(data.username ?? null))
      .catch(() => {});
  }

  useEffect(refresh, []);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await fetch(`${API_BASE}/settings/username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: trimmed }),
    });
    setEditing(false);
    refresh();
  }

  return (
    <div className="pref-row glass-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="avatar">{(username ?? '?').charAt(0).toUpperCase()}</span>
        {editing ? (
          <input
            className="select-field"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        ) : (
          <div>{username ?? '—'}</div>
        )}
      </div>
      {editing ? (
        <button className="btn small primary" onClick={save} disabled={!draft.trim()}>Save</button>
      ) : (
        <button className="btn small" onClick={() => { setDraft(username ?? ''); setEditing(true); }}>Edit</button>
      )}
    </div>
  );
}

interface LogItem {
  id: string;
  kind: 'user' | 'automated';
  os: string;
  username: string;
  description: string;
  createdAt: string;
  imageCount: number;
  dirPath: string;
  imagePaths: string[];
}

function ErrorLogSection() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function refresh() {
    fetch(`${API_BASE}/logs`)
      .then((res) => res.json())
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => {});
  }

  useEffect(refresh, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A webmail compose-by-URL (Gmail, Outlook, etc) has no parameter for attaching a local file — that's a
  // real browser security boundary, not something any link can work around, which is why a plain Gmail
  // link could only ever get you a prefilled draft with nothing attached. macOS Mail.app is scriptable and
  // CAN attach real files to a real draft, so that's what actually delivers on "just click send" — the
  // draft opens in Mail.app with everything already attached, still unsent until the user hits Send.
  async function reportErrors() {
    if (selected.size === 0) return;
    const chosen = logs.filter((l) => selected.has(l.id));
    const username = chosen[0]?.username ?? '';
    const subject = `AllieMinate Mac Error Logs Reporting - ${username}`;
    const body = [
      'Log(s) selected:',
      ...chosen.map((l) => `- ${l.id} (${l.kind === 'automated' ? 'Automated' : 'User'}, ${new Date(l.createdAt).toLocaleString()})`),
    ].join('\n');
    const attachmentPaths = chosen.flatMap((l) => l.imagePaths);

    const result = await window.alliminate.composeMailWithAttachments({
      to: 'vansh080605@gmail.com',
      subject,
      body,
      attachmentPaths,
    });

    if (!result.ok) {
      // Mail.app isn't set up / scripting was denied — fall back to a prefilled Gmail draft plus the log
      // folders revealed in Finder, so there's still a path to sending even without Mail.app.
      for (const log of chosen) await window.alliminate.showInFinder(log.dirPath);
      const fallbackBody = `${body}\n\n(Couldn't open Mail.app automatically — the log folder(s) above were just revealed in Finder. Please drag them into this email before sending.)`;
      const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent('vansh080605@gmail.com')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(fallbackBody)}`;
      await window.alliminate.openExternal(url);
    }
  }

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>Felt a Problem?</div>
      <div className="pref-row glass-card">
        <div>
          <div>Record Error Log to System</div>
          <div className="desc">Describe what went wrong and attach up to 5 screenshots — saved locally on this Mac</div>
        </div>
        <button className="btn small" onClick={() => setShowRecordModal(true)}>Record Error Log to System</button>
      </div>

      <div className="section-title">Error Logs</div>
      {logs.length === 0 && <div className="glass-card empty-state">No logs recorded yet</div>}
      {logs.length > 0 && (
        <div className="glass-card" style={{ padding: 8 }}>
          {logs.map((log) => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderBottom: '1px solid var(--hairline)' }}>
              <input type="checkbox" checked={selected.has(log.id)} onChange={() => toggle(log.id)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {log.kind === 'automated' ? 'Automated Log' : 'User Log'} — {new Date(log.createdAt).toLocaleDateString()}
                </div>
                <div className="desc" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {new Date(log.createdAt).toLocaleTimeString()} · {log.imageCount} image{log.imageCount === 1 ? '' : 's'} · {log.description}
                </div>
              </div>
            </div>
          ))}
          <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={selected.size === 0} onClick={reportErrors}>
            Report the Errors{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      )}

      {showRecordModal && <RecordLogModal onClose={() => setShowRecordModal(false)} onSaved={refresh} />}
    </>
  );
}

function MasterDeviceToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/settings/master-device`)
      .then((res) => res.json())
      .then((data) => setEnabled(data.enabled !== false))
      .catch(() => setEnabled(true));
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    await fetch(`${API_BASE}/settings/master-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
  }

  return <button className={`toggle${enabled ? ' on' : ''}`} onClick={toggle} disabled={enabled === null} />;
}

function NearbyShareToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/settings/nearby-share`)
      .then((res) => res.json())
      .then((data) => setEnabled(data.enabled !== false))
      .catch(() => setEnabled(true));
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    await fetch(`${API_BASE}/settings/nearby-share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
  }

  return <button className={`toggle${enabled ? ' on' : ''}`} onClick={toggle} disabled={enabled === null} />;
}

function ReceivePathRow() {
  const [path, setPath] = useState<string | null>(null);

  function refresh() {
    fetch(`${API_BASE}/settings/receive-path`)
      .then((res) => res.json())
      .then((data) => setPath(data.path))
      .catch(() => {});
  }

  useEffect(refresh, []);

  async function choose() {
    const result = await window.alliminate.pickFolder();
    if (result.canceled || !result.path) return;
    await fetch(`${API_BASE}/settings/receive-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: result.path }),
    });
    refresh();
  }

  return (
    <div className="pref-row glass-card">
      <div>
        <div>Files Received From Phone</div>
        <div className="desc" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5 }}>{path ?? 'Loading…'}</div>
      </div>
      <button className="btn small" onClick={choose}>Choose…</button>
    </div>
  );
}

const GB = 1024 ** 3;
const CACHE_SIZE_OPTIONS = [1, 2, 3, 4, 5];

function FileCacheSection() {
  const [status, setStatus] = useState<{ usedBytes: number; maxBytes: number } | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    fetch(`${API_BASE}/cache/status`)
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => {});
  }

  useEffect(refresh, []);

  async function setMaxGb(gb: number) {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/cache/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxBytes: gb * GB }),
      });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm('Clear the local file cache? Files opened in external apps will re-download next time.')) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/cache/clear`, { method: 'POST' });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const pct = status.maxBytes > 0 ? Math.min(100, (status.usedBytes / status.maxBytes) * 100) : 0;
  const level = pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : 'ok';

  return (
    <>
      <div className="section-title">File Cache</div>
      <div className="glass-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span>{formatBytes(status.usedBytes)} of {formatBytes(status.maxBytes)} used</span>
          <select
            className="select-field"
            value={Math.round(status.maxBytes / GB)}
            disabled={busy}
            onChange={(e) => setMaxGb(Number(e.target.value))}
          >
            {CACHE_SIZE_OPTIONS.map((gb) => (
              <option key={gb} value={gb}>{gb} GB</option>
            ))}
          </select>
        </div>
        <div className="meter-track">
          <div
            className={`meter-fill${level === 'danger' ? ' warn' : ''}`}
            style={{
              width: `${Math.max(pct, 2)}%`,
              background: level === 'danger' ? 'var(--offline)' : level === 'warn' ? 'var(--warning)' : undefined,
            }}
          />
        </div>
        {level !== 'ok' && (
          <div style={{ fontSize: 11.5, color: level === 'danger' ? 'var(--offline)' : 'var(--warning)' }}>
            {level === 'danger' ? 'Cache nearly full — oldest files will be evicted automatically.' : 'Cache getting full.'}
          </div>
        )}
        <button className="btn small danger-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={clear}>
          Clear Cache
        </button>
      </div>
    </>
  );
}

const OPEN_WITH_CATEGORIES: { key: string; label: string }[] = [
  { key: 'pdf', label: 'PDF files' },
  { key: 'docx', label: 'Word documents' },
  { key: 'spreadsheet', label: 'Spreadsheets (.xlsx/.csv)' },
  { key: 'pptx', label: 'PowerPoint files' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
  { key: 'audio', label: 'Music / Audio' },
];

function DefaultAppsSection() {
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [apps, setApps] = useState<Record<string, { name: string; path: string }[]>>({});

  function refresh() {
    fetch(`${API_BASE}/open-with`)
      .then((res) => res.json())
      .then((data) => {
        setPrefs(data.prefs ?? {});
        setApps(data.apps ?? {});
      })
      .catch(() => {});
  }

  useEffect(refresh, []);

  async function setPref(category: string, appPath: string) {
    await fetch(`${API_BASE}/open-with`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, appPath: appPath || null }),
    });
    refresh();
  }

  return (
    <>
      <div className="section-title">Default Apps</div>
      <div className="glass-card" style={{ padding: '4px 16px' }}>
        {OPEN_WITH_CATEGORIES.map(({ key, label }) => (
          <div key={key} className="pref-row" style={{ padding: '10px 0' }}>
            <div>{label}</div>
            <select
              className="select-field"
              value={prefs[key] ?? ''}
              onChange={(e) => setPref(key, e.target.value)}
            >
              <option value="">System Default</option>
              {(apps[key] ?? []).map((a) => (
                <option key={a.path} value={a.path}>{a.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </>
  );
}

interface PhotosAccountInfo {
  accountId: string;
  label: string;
}

function GooglePhotosSection() {
  const [accounts, setAccounts] = useState<PhotosAccountInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    fetch(`${API_BASE}/photos/accounts`)
      .then((res) => res.json())
      .then((data) => setAccounts(data.accounts ?? []))
      .catch(() => {});
  }

  useEffect(refresh, []);

  async function addAccount() {
    setBusyId('add');
    setWaiting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/photos/connect`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "couldn't start Google sign-in");
      const start = Date.now();
      const startCount = accounts.length;
      const poll = setInterval(async () => {
        const accRes = await fetch(`${API_BASE}/photos/accounts`);
        const accData = await accRes.json();
        if ((accData.accounts?.length ?? 0) > startCount || Date.now() - start > 120_000) {
          clearInterval(poll);
          setWaiting(false);
          setBusyId(null);
          setAccounts(accData.accounts ?? []);
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWaiting(false);
      setBusyId(null);
    }
  }

  async function removeAccount(accountId: string, label: string) {
    if (!window.confirm(`Remove ${label} from Google Photos?`)) return;
    setBusyId(accountId);
    try {
      await fetch(`${API_BASE}/photos/accounts/${accountId}`, { method: 'DELETE' });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="section-title">Google Photos</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && <div className="glass-card empty-state" style={{ color: 'var(--offline)', textAlign: 'left', padding: '10px 16px' }}>{error}</div>}
        {waiting && <div className="glass-card empty-state" style={{ textAlign: 'left', padding: '10px 16px' }}>Waiting for you to finish signing in to Google in the browser…</div>}
        {accounts.map((a) => (
          <div className="provider-row glass-card" key={a.accountId}>
            <div className="provider-icon" style={{ background: '#ea4335' }}>{a.label.charAt(0).toUpperCase()}</div>
            <div className="provider-info">
              <div className="name">{a.label}</div>
              <div className="meta">Connected</div>
            </div>
            <button className="btn small danger-outline" disabled={busyId === a.accountId} onClick={() => removeAccount(a.accountId, a.label)}>
              {busyId === a.accountId ? '…' : 'Remove'}
            </button>
          </div>
        ))}
        <button className="btn small" style={{ alignSelf: 'flex-start' }} disabled={busyId === 'add' || accounts.length >= 7} onClick={addAccount}>
          {busyId === 'add' ? 'Waiting…' : accounts.length >= 7 ? 'Max 7 accounts linked' : '+ Add Google Photos account'}
        </button>
      </div>
    </>
  );
}

export function SettingsView({
  connected,
  storage,
  onRefresh,
}: {
  connected: string[];
  storage: ProviderStorage[];
  onRefresh: () => void;
}) {
  const [connectTarget, setConnectTarget] = useState<{ id: StorageProviderId; name: string; kind: 's3' | 'mega' } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [oauthWaiting, setOauthWaiting] = useState<'primary' | 'add-account' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [extraAccounts, setExtraAccounts] = useState<DriveAccountInfo[]>([]);
  const [renamingAccount, setRenamingAccount] = useState<DriveAccountInfo | null>(null);
  const [pcloudConfigured, setPcloudConfigured] = useState(true); // assume yes until we hear otherwise, avoids a flash of "needs setup"
  const [onedriveConfigured, setOnedriveConfigured] = useState(true);

  async function refreshAccounts() {
    const res = await fetch(`${API_BASE}/accounts`);
    const data = await res.json();
    setExtraAccounts(data.accounts ?? []);
  }

  useEffect(() => {
    refreshAccounts();
  }, [connected.length]);

  useEffect(() => {
    fetch(`${API_BASE}/config-status`)
      .then((res) => res.json())
      .then((data) => {
        setPcloudConfigured(!!data.pcloudConfigured);
        setOnedriveConfigured(!!data.onedriveConfigured);
      })
      .catch(() => {});
  }, []);

  async function logOut(id: string) {
    if (!window.confirm(`Log out of ${id}? Saved credentials stay in .env — this just disconnects the app.`)) return;
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/providers/${id}/disconnect`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'disconnect failed');
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function logOutAll() {
    if (!window.confirm(`Log out of all ${connected.length} connected cloud service(s)? Saved credentials stay in .env — this just disconnects the app.`)) return;
    setBusyId('logout-all');
    setActionError(null);
    try {
      await Promise.all(
        connected.map((id) => fetch(`${API_BASE}/providers/${id}/disconnect`, { method: 'POST' })),
      );
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function removeExtraAccount(accountId: string, label: string) {
    if (!window.confirm(`Remove ${label}? Its upload folder goes with it.`)) return;
    setBusyId(accountId);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'remove failed');
      await refreshAccounts();
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function renameAccount(accountId: string, label: string) {
    setBusyId(accountId);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'rename failed');
      setRenamingAccount(null);
      await refreshAccounts();
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function logInOAuth(providerId: string) {
    setBusyId(providerId);
    setActionError(null);
    setOauthWaiting('primary');
    try {
      const res = await fetch(`${API_BASE}/providers/${providerId}/connect`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `couldn't start ${providerId} sign-in`);
      const start = Date.now();
      const poll = setInterval(async () => {
        const statusRes = await fetch(`${API_BASE}/status`);
        const statusData = await statusRes.json();
        if (statusData.providers?.includes(providerId) || Date.now() - start > 120_000) {
          clearInterval(poll);
          setOauthWaiting(null);
          setBusyId(null);
          onRefresh();
        }
      }, 2000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setOauthWaiting(null);
      setBusyId(null);
    }
  }

  async function addGoogleDriveAccount() {
    setBusyId('add-account');
    setActionError(null);
    setOauthWaiting('add-account');
    try {
      const res = await fetch(`${API_BASE}/accounts/google-drive/add`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'couldn\'t start Google sign-in');
      const start = Date.now();
      const startCount = extraAccounts.length;
      const poll = setInterval(async () => {
        const accountsRes = await fetch(`${API_BASE}/accounts`);
        const accountsData = await accountsRes.json();
        if ((accountsData.accounts?.length ?? 0) > startCount || Date.now() - start > 120_000) {
          clearInterval(poll);
          setOauthWaiting(null);
          setBusyId(null);
          setExtraAccounts(accountsData.accounts ?? []);
          onRefresh();
        }
      }, 2000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setOauthWaiting(null);
      setBusyId(null);
    }
  }

  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>Settings</h1>
          <p>Manage connected clouds and app preferences</p>
        </div>
      </div>

      {actionError && (
        <div className="glass-card empty-state" style={{ color: 'var(--offline)', textAlign: 'left', padding: '10px 16px' }}>
          {actionError}
        </div>
      )}
      {oauthWaiting && (
        <div className="glass-card empty-state" style={{ textAlign: 'left', padding: '10px 16px' }}>
          Waiting for you to finish signing in to Google in the browser…
        </div>
      )}

      <div className="settings-group">
        <div className="section-title" style={{ marginTop: 0 }}>Your Name</div>
        <UsernameRow />
      </div>

      <div className="settings-group">
        <div className="section-title">Connected Clouds</div>
        {ALL_PROVIDERS.map((p) => {
          const isConnected = connected.includes(p.id);
          // Google Drive is multi-account — the top-level row should read as "everything linked under
          // Drive," not just the primary account's own slice, same combined total the sidebar already
          // shows. Every other provider here is single-account, so its own usage entry is already the
          // whole picture.
          const isDrive = p.id === 'google-drive';
          const driveEntries = isDrive ? storage.filter((s) => baseProviderOf(s.provider) === 'google-drive') : [];
          const usage = isDrive
            ? driveEntries.length
              ? { usedBytes: driveEntries.reduce((sum, s) => sum + s.usedBytes, 0), totalBytes: driveEntries.reduce((sum, s) => sum + s.totalBytes, 0) }
              : undefined
            : storage.find((s) => s.provider === p.id);
          const buildable = p.kind !== undefined;
          const needsSetup = (p.id === 'pcloud' && !pcloudConfigured) || (p.id === 'onedrive' && !onedriveConfigured);
          const setupEnvVars = p.id === 'pcloud' ? 'PCLOUD_CLIENT_ID/SECRET' : 'ONEDRIVE_CLIENT_ID/SECRET';
          return (
            <React.Fragment key={p.id}>
              <div className="provider-row glass-card" style={{ flexWrap: 'wrap' }}>
                <div className="provider-icon">
                  <img src={CLOUD_ICONS[p.id]} alt="" />
                </div>
                <div className="provider-info">
                  <div className="name">{p.name}</div>
                  <div className={`meta${!isConnected ? ' pending' : ''}`}>
                    {isConnected
                      ? usage
                        ? `Connected · ${formatBytes(usage.usedBytes)} of ${formatBytes(usage.totalBytes)} used`
                        : 'Connected'
                      : needsSetup
                      ? `Needs setup — add ${setupEnvVars} to .env first`
                      : p.pendingNote ?? 'Not connected'}
                  </div>
                  {isConnected && usage && <UsageBar usedBytes={usage.usedBytes} totalBytes={usage.totalBytes} />}
                </div>
                <button
                  className={`btn ${isConnected ? 'danger-outline' : 'primary'}`}
                  disabled={busyId === p.id || (!isConnected && !buildable) || (!isConnected && needsSetup)}
                  onClick={() => {
                    if (isConnected) return logOut(p.id);
                    if (p.kind === 'oauth') return logInOAuth(p.id);
                    if (p.kind === 's3' || p.kind === 'mega') setConnectTarget({ id: p.id, name: p.name, kind: p.kind });
                  }}
                >
                  {busyId === p.id ? '…' : isConnected ? 'Log Out' : 'Log In'}
                </button>
              </div>

              {p.id === 'google-drive' && isConnected && (
                <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {extraAccounts.map((a) => {
                    const usage2 = storage.find((s) => s.provider === a.accountId);
                    return (
                      <div className="provider-row glass-card" key={a.accountId} style={{ padding: '8px 14px' }}>
                        <div className="provider-icon" style={{ background: '#4285f4', width: 26, height: 26, fontSize: 11 }}>
                          {a.label.charAt(0).toUpperCase()}
                        </div>
                        <div className="provider-info">
                          <div className="name" style={{ fontSize: 12.5 }}>{a.label}</div>
                          <div className="meta">{usage2 ? `Connected · ${formatBytes(usage2.usedBytes)} used` : 'Connected'}</div>
                          {usage2 && <UsageBar usedBytes={usage2.usedBytes} totalBytes={usage2.totalBytes} />}
                        </div>
                        <button
                          className="btn small"
                          disabled={busyId === a.accountId}
                          onClick={() => setRenamingAccount(a)}
                        >
                          Rename
                        </button>
                        <button
                          className="btn small danger-outline"
                          disabled={busyId === a.accountId}
                          onClick={() => removeExtraAccount(a.accountId, a.label)}
                        >
                          {busyId === a.accountId ? '…' : 'Remove'}
                        </button>
                      </div>
                    );
                  })}
                  <button
                    className="btn small"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={busyId === 'add-account' || extraAccounts.length >= 6}
                    onClick={addGoogleDriveAccount}
                  >
                    {busyId === 'add-account' ? 'Waiting…' : extraAccounts.length >= 6 ? 'Max 7 accounts linked' : '+ Add another Google account'}
                  </button>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="settings-group">
        <GooglePhotosSection />
      </div>

      <div className="settings-group">
        <div className="section-title">Sync Preferences</div>
        <div className="pref-row glass-card">
          <div><div>Conflict resolution</div><div className="desc">When the same file changes on two devices</div></div>
          <select className="select-field right"><option>Ask me each time</option><option>Keep both versions</option><option>Newest wins</option></select>
        </div>
        <div className="pref-row glass-card">
          <div><div>Bandwidth limit</div><div className="desc">Cap upload/download speed</div></div>
          <BandwidthLimitSelect />
        </div>
        <div className="pref-row glass-card">
          <div><div>Pause sync on metered connection</div><div className="desc">Avoid eating mobile hotspot data</div></div>
          <Toggle initial />
        </div>
      </div>

      <div className="settings-group">
        <div className="section-title">Security</div>
        <div className="pref-row glass-card">
          <div><div>App Lock</div><div className="desc">Require Touch ID or PIN to open AllieMinate</div></div>
          <AppLockToggle />
        </div>
      </div>

      <div className="settings-group">
        <div className="section-title">Devices</div>
        <div className="pref-row glass-card">
          <div><div>Master Device</div><div className="desc">Let your phone and other devices pair with this Mac and browse its connected clouds</div></div>
          <MasterDeviceToggle />
        </div>
        <div className="pref-row glass-card">
          <div><div>Nearby Share</div><div className="desc">Show this device as a quick-share target on your other paired devices</div></div>
          <NearbyShareToggle />
        </div>
        <ReceivePathRow />
      </div>

      <div className="settings-group">
        <div className="section-title">General</div>
        <div className="pref-row glass-card">
          <div><div>Open at Boot</div><div className="desc">Start AllieMinate automatically when you sign in to your Mac</div></div>
          <LaunchAtLoginToggle />
        </div>
        <div className="pref-row glass-card">
          <div><div>Appearance</div><div className="desc">Follows System · Light · Dark</div></div>
          <span className="provider-chip right">System</span>
        </div>

        <DefaultAppsSection />
        <FileCacheSection />

        <div className="section-title">Danger Zone</div>
        <button
          className="btn danger-outline"
          style={{ width: '100%' }}
          disabled={connected.length === 0 || busyId === 'logout-all'}
          onClick={logOutAll}
        >
          {busyId === 'logout-all' ? 'Logging out…' : 'Log Out of All Services'}
        </button>
      </div>

      <div className="settings-group">
        <ErrorLogSection />
      </div>

      {connectTarget && (
        <ConnectProviderModal
          providerId={connectTarget.id}
          providerName={connectTarget.name}
          kind={connectTarget.kind}
          onClose={() => setConnectTarget(null)}
          onConnected={onRefresh}
        />
      )}

      {renamingAccount && (
        <RenameModal
          currentName={renamingAccount.label}
          onClose={() => setRenamingAccount(null)}
          onConfirm={(name) => renameAccount(renamingAccount.accountId, name)}
        />
      )}
    </section>
  );
}
