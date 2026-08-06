import React, { useEffect, useRef, useState } from 'react';
import type { ProviderStorage, SyncEvent } from '@alliminate/shared';
import type { StatusResponse, ActivityEntry, FilesByFolder, ClipboardEntry } from './lib/types';
import { Sidebar, ViewId } from './components/Sidebar';
import { UploadModal } from './components/UploadModal';
import { Modal } from './components/Modal';
import { formatBytes, escapeHtml } from './lib/format';
import { OverviewView } from './views/OverviewView';
import { FilesView } from './views/FilesView';
import { PinnedFoldersView } from './views/PinnedFoldersView';
import { CloudServicesView } from './views/CloudServicesView';
import { GooglePhotosView } from './views/GooglePhotosView';
import { DevicesView } from './views/DevicesView';
import { ShareView } from './views/ShareView';
import { TrashView } from './views/TrashView';
import { SettingsView } from './views/SettingsView';
import { SyncView } from './views/SyncView';
import { LockScreen } from './components/LockScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { GlobalSearch } from './components/GlobalSearch';

const API_BASE = 'http://localhost:4310';
const WS_URL = 'ws://localhost:4310/ws';
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

let activityCounter = 0;

export function App(): JSX.Element {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [storage, setStorage] = useState<ProviderStorage[]>([]);
  const [filesByFolder, setFilesByFolder] = useState<FilesByFolder>({});
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<ViewId>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [pinnedOpenRequest, setPinnedOpenRequest] = useState<{ folderId: string; nonce: number } | null>(null);
  const [locked, setLocked] = useState<boolean | null>(null); // null = still checking
  const [username, setUsername] = useState<string | null | undefined>(undefined); // undefined = still checking, null = needs onboarding
  const [clipboard, setClipboard] = useState<ClipboardEntry>(null);
  const [incomingNearbyRequest, setIncomingNearbyRequest] = useState<{ id: string; fromName: string; fileName: string; fileSize: number } | null>(null);
  const [incomingUnlockRequest, setIncomingUnlockRequest] = useState<{ id: string; fromName: string } | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const refreshDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshFailures = useRef(0);

  useEffect(() => {
    window.security.isEnabled().then(setLocked);
  }, []);

  // this fetch had no timeout — if the backend accepted the connection but was slow to respond (a slow
  // cold-boot sync pass, a hung upstream provider call, anything short of the process actually crashing,
  // which is the only case the separate backend-process auto-restart in main/index.ts covers), the promise
  // just sat pending forever, `username` stayed undefined forever, and the blank-shell fallback below
  // rendered forever with zero indication anything was happening — exactly the "blank black window on cold
  // boot" report. Retry on a bounded per-attempt timeout instead of hanging indefinitely on one attempt.
  useEffect(() => {
    let cancelled = false;
    async function loadUsername() {
      while (!cancelled) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(`${API_BASE}/settings/username`, { signal: controller.signal });
          clearTimeout(timer);
          const data = await res.json();
          if (!cancelled) setUsername(data.username ?? null);
          return;
        } catch {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    loadUsername();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      try {
        const [statusRes, storageRes] = await Promise.all([
          fetch(`${API_BASE}/status`),
          fetch(`${API_BASE}/storage`),
        ]);
        const statusData: StatusResponse = await statusRes.json();
        const storageData: { providers?: ProviderStorage[] } = await storageRes.json();
        if (cancelled) return;
        setStatus(statusData);
        // a malformed/error-shaped response here used to set storage to undefined, which crashed every
        // downstream `for (const s of storage)` with "storage is not iterable" — this is now caught
        // upstream in the /storage route itself too, but stay defensive on the response shape regardless.
        setStorage(storageData.providers ?? []);
        setError(null);

        for (const folder of statusData.folders) {
          // one flaky provider (MEGA in particular has real intermittent connectivity issues) throwing here
          // used to abort the WHOLE refresh and flip the top-level "backend unreachable" banner even though
          // the backend and every OTHER folder were completely fine — isolate it to just that folder.
          try {
            const filesRes = await fetch(`${API_BASE}/folders/${folder.id}/files`);
            const filesData = await filesRes.json();
            if (cancelled) return;
            setFilesByFolder((prev) => ({ ...prev, [folder.id]: filesData.files ?? [] }));
          } catch {
            if (cancelled) return;
          }
        }
        refreshFailures.current = 0;
      } catch {
        if (cancelled) return;
        setError('backend unreachable');
        // refresh() otherwise only reruns on a WS message — if this first call loses the race against a
        // still-booting backend and the WS socket also isn't up yet to ever deliver one, nothing was ever
        // scheduled to try again, leaving the UI stuck on "backend unreachable" forever even once the
        // backend comes up. Keep retrying until a refresh actually succeeds, backing off so a genuinely
        // down backend doesn't get hammered every couple seconds forever.
        refreshFailures.current += 1;
        const delay = Math.min(RECONNECT_DELAY_MS * 2 ** (refreshFailures.current - 1), MAX_RECONNECT_DELAY_MS);
        setTimeout(() => {
          if (!cancelled) refresh();
        }, delay);
      }
    }

    refreshRef.current = refresh;
    refresh();

    // WS-triggered refreshes used to fire immediately, one per message — with 7 cloud accounts each
    // independently completing a background storage refresh, a burst of near-simultaneous
    // 'storage-updated' events could kick off several OVERLAPPING refresh() calls within a second or two.
    // If even one of those overlapping calls happened to fail while its neighbors succeeded, the top
    // "backend unreachable" banner would flash on then immediately clear — a visible flicker despite the
    // backend being completely healthy the whole time. Debouncing collapses a burst into one refresh.
    function scheduleRefresh(): void {
      if (refreshDebounceTimer.current) clearTimeout(refreshDebounceTimer.current);
      refreshDebounceTimer.current = setTimeout(() => {
        if (!cancelled) refreshRef.current();
      }, 400);
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
      if (cancelled) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        refreshRef.current();
      };

      ws.onmessage = (msg) => {
        try {
          const event: SyncEvent = JSON.parse(msg.data);
          // a background storage-cache refresh finishing isn't a file activity worth cluttering the
          // Activity feed with — it just means /storage has fresher numbers now, so refetch and stop here.
          if (event.type === 'storage-updated') {
            scheduleRefresh();
            return;
          }
          // someone on the LAN wants to send THIS device a file via Nearby Share — no prior pairing, so
          // this is the actual consent step (see /nearby/request on the backend). Only surfaces while the
          // app window is open; there's no OS-level notification path for this yet.
          if (event.type === 'nearby-request') {
            const payload = event.payload as { id: string; fromName: string; fileName: string; fileSize: number };
            setIncomingNearbyRequest(payload);
            return;
          }
          // a paired device is asking THIS Mac to approve ITS unlock (Phase 3, symmetric direction) — same
          // consent step as the nearby-file case, just for /unlock/request instead.
          if (event.type === 'unlock-request') {
            const payload = event.payload as { id: string; fromName: string };
            setIncomingUnlockRequest(payload);
            return;
          }
          // a paired device just pushed a file straight into this Mac/PC's own inbox (device-to-device
          // Share, from either another AllieMinate desktop or a phone's share-sheet) — a real OS
          // notification for this, not just an Activity feed line, since the whole point is the user
          // finding out even when the app window isn't focused.
          if (event.type === 'file-synced' && event.folderId === 'device-inbox') {
            const payload = event.payload as { key?: string; from?: string } | undefined;
            const fileName = payload?.key ?? 'A file';
            try {
              new Notification('File Received', { body: payload?.from ? `"${fileName}" from ${payload.from}` : `"${fileName}"` });
            } catch {
              // Notification unsupported/blocked — the Activity feed entry below still shows it.
            }
          }
          const key = typeof event.payload === 'object' && event.payload && 'key' in event.payload
            ? String((event.payload as { key: unknown }).key)
            : event.folderId;
          const statusPayload = event.type === 'status' && typeof event.payload === 'object' ? event.payload as { provider?: string; connected?: boolean } : null;
          const filePayload = typeof event.payload === 'object' ? event.payload as { key?: string; size?: number; deleted?: boolean } : null;
          const conflictPayload = event.type === 'conflict' && typeof event.payload === 'object' ? event.payload as { resolution?: string } : null;
          const text =
            event.type === 'file-synced'
              ? `Synced <b>${escapeHtml(key.split('/').pop() ?? key)}</b>`
              : event.type === 'error'
                ? `Error syncing ${escapeHtml(key)}`
                : event.type === 'conflict'
                  ? `Auto-Sync conflict on <b>${escapeHtml(key.split('/').pop() ?? key)}</b> — ${escapeHtml(conflictPayload?.resolution ?? 'resolved')}`
                  : statusPayload?.provider
                    ? `<b>${escapeHtml(statusPayload.provider)}</b> ${statusPayload.connected ? 'connected' : 'disconnected'}`
                    : `${escapeHtml(event.type)} · ${escapeHtml(key)}`;
          activityCounter += 1;
          const kind: ActivityEntry['kind'] = event.type === 'error' ? 'error' : event.type === 'conflict' ? 'error' : 'synced';
          const hasThumb = event.type === 'file-synced' && filePayload && !filePayload.deleted;
          setActivity((prev) => [
            {
              id: `a${activityCounter}`,
              text,
              kind,
              ts: new Date().toISOString(),
              folderId: hasThumb ? event.folderId : undefined,
              fileKey: hasThumb ? filePayload?.key : undefined,
              size: hasThumb ? filePayload?.size : undefined,
            },
            ...prev,
          ].slice(0, 50));
        } catch {
          // ignore malformed events
        }
        scheduleRefresh();
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refreshDebounceTimer.current) clearTimeout(refreshDebounceTimer.current);
      ws?.close();
    };
  }, []);

  const folders = status?.folders ?? [];
  const loading = status === null;

  function openFolder(id: string) {
    setPinnedOpenRequest({ folderId: id, nonce: Date.now() });
    setView('pinned');
  }

  async function respondToNearbyRequest(accept: boolean) {
    const request = incomingNearbyRequest;
    if (!request) return;
    setIncomingNearbyRequest(null);
    await fetch(`${API_BASE}/nearby/request/${request.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept }),
    }).catch(() => {});
  }

  async function respondToUnlockRequest(accept: boolean) {
    const request = incomingUnlockRequest;
    if (!request) return;
    setIncomingUnlockRequest(null);
    await fetch(`${API_BASE}/unlock/request/${request.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept }),
    }).catch(() => {});
  }

  // tray panel's "View Files"/"View Devices" link — the window may have just been created for this, so
  // the main process waits for did-finish-load before sending, meaning this listener is always attached
  // in time.
  useEffect(() => {
    return window.alliminate.onNavigate((v) => setView(v as ViewId));
  }, []);

  if (locked === null || username === undefined) {
    return (
      <div
        className="app-shell"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 14 }}
      >
        <span className="brand-mark" style={{ width: 44, height: 44 }} />
        <div style={{ fontSize: 13, color: 'var(--text-secondary, #9a9a9e)' }}>Connecting to AllieMinate…</div>
      </div>
    );
  }
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;
  if (username === null) return <OnboardingScreen onDone={setUsername} />;

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onNavigate={setView}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        storage={storage}
        loading={loading}
        onUpload={() => setUploadOpen(true)}
        accountEmail={username}
      />

      <main className="main">
        <div style={{ display: 'flex', padding: '16px 32px 0' }}>
          <GlobalSearch />
        </div>

        {error && <div className="glass-card empty-state" style={{ margin: '20px 32px' }}>{error} — {connected ? 'reconnecting…' : 'retrying…'}</div>}

        {view === 'overview' && (
          <OverviewView
            folders={folders}
            filesByFolder={filesByFolder}
            activity={activity}
            storage={storage}
            loading={loading}
            onOpenFolder={openFolder}
            onGoToDevices={() => setView('devices')}
            onRefresh={() => refreshRef.current()}
            clipboard={clipboard}
            onClipboardChange={setClipboard}
          />
        )}
        {view === 'files' && <FilesView folders={folders} filesByFolder={filesByFolder} storage={storage} loading={loading} onRefresh={() => refreshRef.current()} clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'cat-image' && <FilesView folders={folders} filesByFolder={filesByFolder} storage={storage} loading={loading} onRefresh={() => refreshRef.current()} category="image" title="Images" subtitle="Every image across your connected clouds" clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'cat-video' && <FilesView folders={folders} filesByFolder={filesByFolder} storage={storage} loading={loading} onRefresh={() => refreshRef.current()} category="video" title="Videos" subtitle="Every video across your connected clouds" clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'cat-audio' && <FilesView folders={folders} filesByFolder={filesByFolder} storage={storage} loading={loading} onRefresh={() => refreshRef.current()} category="audio" title="Audio" subtitle="Every audio file across your connected clouds" clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'cat-document' && <FilesView folders={folders} filesByFolder={filesByFolder} storage={storage} loading={loading} onRefresh={() => refreshRef.current()} category="document" title="Documents" subtitle="PDFs, Word, Excel & more across your connected clouds" clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'cat-archive' && <FilesView folders={folders} filesByFolder={filesByFolder} storage={storage} loading={loading} onRefresh={() => refreshRef.current()} category="archive" title="Archives" subtitle="ZIP and archive files across your connected clouds" clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'pinned' && <PinnedFoldersView folders={folders} filesByFolder={filesByFolder} storage={storage} openRequest={pinnedOpenRequest} loading={loading} onRefresh={() => refreshRef.current()} clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'sync' && <SyncView storage={storage} activity={activity} />}
        {view === 'cloud-services' && <CloudServicesView connected={status?.providers ?? []} loading={loading} folders={folders} storage={storage} clipboard={clipboard} onClipboardChange={setClipboard} onOpenPinnedFolder={openFolder} onOpenSync={() => setView('sync')} />}
        {view === 'google-photos' && <GooglePhotosView />}
        {view === 'devices' && <DevicesView clipboard={clipboard} onClipboardChange={setClipboard} />}
        {view === 'share' && <ShareView />}
        {view === 'trash' && <TrashView />}
        {view === 'settings' && (
          <SettingsView connected={status?.providers ?? []} storage={storage} onRefresh={() => refreshRef.current()} onGoToDevices={() => setView('devices')} />
        )}
      </main>

      {uploadOpen && (
        <UploadModal
          storage={storage}
          apiBase={API_BASE}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => refreshRef.current()}
        />
      )}

      {incomingNearbyRequest && (
        <Modal
          title="Nearby Share Request"
          onClose={() => respondToNearbyRequest(false)}
          footer={
            <>
              <button className="btn" onClick={() => respondToNearbyRequest(false)}>Decline</button>
              <button className="btn primary" onClick={() => respondToNearbyRequest(true)}>Accept</button>
            </>
          }
        >
          <div style={{ fontSize: 13 }}>
            <b>{incomingNearbyRequest.fromName}</b> wants to send you <b>{incomingNearbyRequest.fileName}</b>
            {incomingNearbyRequest.fileSize > 0 ? ` (${formatBytes(incomingNearbyRequest.fileSize)})` : ''} over Nearby Share.
          </div>
        </Modal>
      )}

      {incomingUnlockRequest && (
        <Modal
          title="Unlock Approval Request"
          onClose={() => respondToUnlockRequest(false)}
          footer={
            <>
              <button className="btn" onClick={() => respondToUnlockRequest(false)}>Decline</button>
              <button className="btn primary" onClick={() => respondToUnlockRequest(true)}>Approve</button>
            </>
          }
        >
          <div style={{ fontSize: 13 }}>
            <b>{incomingUnlockRequest.fromName}</b> wants you to approve unlocking AllieMinate on it.
          </div>
        </Modal>
      )}
    </div>
  );
}
