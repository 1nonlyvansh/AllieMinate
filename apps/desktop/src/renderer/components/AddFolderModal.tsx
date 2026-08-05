import React, { useEffect, useMemo, useState } from 'react';
import type { ProviderStorage, FolderNode } from '@alliminate/shared';
import { baseProviderOf } from '@alliminate/shared';
import type { FolderMeta } from '../lib/types';
import { CLOUD_ICONS } from '../lib/cloudIcons';
import { Modal } from './Modal';
import { IconChevronLeft, IconFolder, IconAdd } from '../icons';

const API_BASE = 'http://localhost:4310';

const PROVIDER_LABEL: Record<string, string> = {
  b2: 'Backblaze B2',
  'idrive-e2': 'IDrive e2',
  'google-drive': 'Google Drive',
  mega: 'MEGA',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
};

// only Drive has real folder OBJECTS we can create — every other provider organizes storage by flat key
// prefixes, so there's no separate "make it real" step for them; a pinned folder there is already real
// the moment a file lands in it.
const SUPPORTS_REAL_FOLDER = new Set(['google-drive']);

interface Crumb {
  id: string | null;
  name: string;
}

export function AddFolderModal({
  folders,
  storage,
  onClose,
  onDone,
}: {
  folders: FolderMeta[];
  storage: ProviderStorage[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<'existing' | 'create'>('existing');
  const [existingProvider, setExistingProvider] = useState<string | null>(null);
  const quickPicksForProvider = useMemo(
    () => folders.filter((f) => f.pinned === false && f.provider === existingProvider),
    [folders, existingProvider],
  );

  // real, navigable folder tree for the chosen account — same /providers/:id/tree browse the Upload
  // dialog and Cloud Services use, so this now shows the account's ACTUAL folders (Personal, TEST ITEMS,
  // etc) instead of only the two auto-generated pseudo-folders the app tracks internally.
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: 'Top Level' }]);
  const [realFolders, setRealFolders] = useState<FolderNode[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [browseSupported, setBrowseSupported] = useState(true);
  const [pinning, setPinning] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingRealFolder, setCreatingRealFolder] = useState(false);

  const currentFolderId = path[path.length - 1].id;

  const [name, setName] = useState('');
  const [provider, setProvider] = useState(storage[0]?.provider ?? '');
  const [createInCloud, setCreateInCloud] = useState(false);
  const [creating, setCreating] = useState(false);

  function labelFor(s: ProviderStorage): string {
    return s.label ?? PROVIDER_LABEL[baseProviderOf(s.provider)] ?? s.provider;
  }

  async function loadTree(pid: string, folderId: string | null) {
    setBrowsing(true);
    try {
      const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
      const res = await fetch(`${API_BASE}/providers/${pid}/tree${qs}`);
      if (res.status === 409) {
        setBrowseSupported(false);
        setRealFolders([]);
        return;
      }
      setBrowseSupported(true);
      const data = await res.json();
      setRealFolders(data.folders ?? []);
    } finally {
      setBrowsing(false);
    }
  }

  useEffect(() => {
    if (existingProvider) loadTree(existingProvider, currentFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingProvider, currentFolderId]);

  function openProvider(id: string) {
    setExistingProvider(id);
    setPath([{ id: null, name: PROVIDER_LABEL[baseProviderOf(id)] ?? id }]);
  }

  function backToClouds() {
    setExistingProvider(null);
    setRealFolders([]);
  }

  function enterFolder(folder: FolderNode) {
    setPath((p) => [...p, { id: folder.id, name: folder.name }]);
  }

  function jumpTo(index: number) {
    setPath((p) => p.slice(0, index + 1));
  }

  async function pinQuick(folderId: string) {
    await fetch(`${API_BASE}/folders/${folderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    onDone();
    onClose();
  }

  async function pinCurrentFolder() {
    if (!existingProvider || !currentFolderId) return;
    setPinning(true);
    try {
      const res = await fetch(`${API_BASE}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: path[path.length - 1].name, provider: existingProvider, remoteFolderId: currentFolderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error ?? "Couldn't pin folder");
        return;
      }
      onDone();
      onClose();
    } finally {
      setPinning(false);
    }
  }

  async function createRealFolder() {
    if (!existingProvider || !newFolderName.trim()) return;
    setCreatingRealFolder(true);
    try {
      const res = await fetch(`${API_BASE}/providers/${existingProvider}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: currentFolderId, name: newFolderName.trim() }),
      });
      if (res.ok) {
        setNewFolderName('');
        setNewFolderOpen(false);
        await loadTree(existingProvider, currentFolderId);
      }
    } finally {
      setCreatingRealFolder(false);
    }
  }

  async function createFolder() {
    if (!name.trim() || !provider) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), provider, createInCloud }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error ?? "Couldn't create folder");
        return;
      }
      onDone();
      onClose();
    } finally {
      setCreating(false);
    }
  }

  const providerSupportsRealFolder = SUPPORTS_REAL_FOLDER.has(baseProviderOf(provider || 'x'));

  return (
    <Modal title="Add Folder" onClose={onClose} size="lg" footer={<button className="btn" onClick={onClose}>Cancel</button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn small${tab === 'existing' ? ' primary' : ''}`} onClick={() => setTab('existing')}>
          Choose Existing
        </button>
        <button className={`btn small${tab === 'create' ? ' primary' : ''}`} onClick={() => setTab('create')}>
          Create Folder
        </button>
      </div>

      {tab === 'existing' && !existingProvider && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
          {storage.map((s) => (
            <button
              key={s.provider}
              className="btn small"
              style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }}
              onClick={() => openProvider(s.provider)}
            >
              <img src={CLOUD_ICONS[baseProviderOf(s.provider)]} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
              <span>{labelFor(s)}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'existing' && existingProvider && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={backToClouds}>
            ← Back to clouds
          </button>

          {!browseSupported && (
            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
              Real folder browsing isn't supported for {PROVIDER_LABEL[baseProviderOf(existingProvider)] ?? existingProvider}.
            </div>
          )}

          {browseSupported && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 12.5 }}>
                {path.map((crumb, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <IconChevronLeft size={10} />}
                    <button
                      disabled={i === path.length - 1}
                      onClick={() => jumpTo(i)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        color: i === path.length - 1 ? 'var(--text)' : 'var(--accent)',
                        cursor: i === path.length - 1 ? 'default' : 'pointer',
                        fontWeight: i === path.length - 1 ? 600 : 400,
                      }}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
                <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setNewFolderOpen((v) => !v)}>
                  <IconAdd size={12} /> New Folder
                </button>
              </div>

              {newFolderOpen && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="select-field"
                    autoFocus
                    placeholder="Folder name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createRealFolder()}
                    style={{ flex: 1 }}
                  />
                  <button className="btn small primary" disabled={creatingRealFolder || !newFolderName.trim()} onClick={createRealFolder}>
                    Create
                  </button>
                </div>
              )}

              {browsing && <div className="empty-state">Loading…</div>}

              {!browsing && realFolders.length === 0 && (
                <div className="empty-state">No subfolders here</div>
              )}

              {!browsing && realFolders.length > 0 && (
                <div className="folder-grid" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {realFolders.map((f) => (
                    <div key={f.id} className="folder-card glass-card" style={{ cursor: 'pointer' }} onClick={() => enterFolder(f)}>
                      <div className="folder-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <IconFolder size={30} />
                      </div>
                      <div className="folder-name" title={f.name}>{f.name}</div>
                    </div>
                  ))}
                </div>
              )}

              <button className="btn primary" disabled={!currentFolderId || pinning} onClick={pinCurrentFolder}>
                {pinning ? 'Pinning…' : currentFolderId ? `Pin "${path[path.length - 1].name}"` : 'Open a folder to pin it'}
              </button>
            </>
          )}

          {quickPicksForProvider.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>Or pin one of these:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {quickPicksForProvider.map((f) => (
                  <button key={f.id} className="btn small" style={{ justifyContent: 'flex-start', display: 'flex' }} onClick={() => pinQuick(f.id)}>
                    {f.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'create' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12.5 }}>Folder name</label>
          <input
            className="select-field"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tax Documents"
          />
          <label style={{ fontSize: 12.5 }}>Cloud account</label>
          <select className="select-field" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {storage.map((s) => (
              <option key={s.provider} value={s.provider}>{labelFor(s)}</option>
            ))}
          </select>

          {providerSupportsRealFolder ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={createInCloud} onChange={(e) => setCreateInCloud(e.target.checked)} />
              Also create this as a real, visible folder in the cloud (not just in AllieMinate)
            </label>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {PROVIDER_LABEL[baseProviderOf(provider || 'x')] ?? 'This provider'} organizes files by name, not folder
              objects — this folder is already real there the moment you add a file to it.
            </div>
          )}

          <button className="btn primary" disabled={!name.trim() || !provider || creating} onClick={createFolder}>
            {creating ? 'Creating…' : 'Create Folder'}
          </button>
        </div>
      )}
    </Modal>
  );
}
