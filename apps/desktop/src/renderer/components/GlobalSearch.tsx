import React, { useEffect, useRef, useState } from 'react';
import { IconSearch } from '../icons';
import { formatBytes } from '../lib/format';

const API_BASE = 'http://localhost:4310';
const SEARCH_DEBOUNCE_MS = 350;

interface SearchResult {
  source: 'cloud' | 'device';
  sourceLabel: string;
  providerId?: string;
  deviceId?: string;
  folderId?: string;
  path: string;
  size: number;
  modifiedAt: string;
  mimeType?: string;
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

// Phase 4: Cross-Device Search — one bar, always visible, hits GET /search which fans out live across
// every connected cloud provider AND every online paired device. Deliberately a lightweight dropdown, not
// a separate view: the point is "find it from wherever you are," not another destination to navigate to.
export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onOutsideClick);
    return () => document.removeEventListener('click', onOutsideClick);
  }, []);

  function onChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!value.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(value.trim())}`);
        const data: { results?: SearchResult[] } = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  async function openResult(r: SearchResult) {
    setOpen(false);
    if (r.source === 'cloud') {
      await fetch(`${API_BASE}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: r.providerId, key: r.path, mimeType: r.mimeType }),
      }).catch(() => {});
    } else {
      await fetch(`${API_BASE}/devices/${r.deviceId}/folders/${r.folderId}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: r.path, mimeType: r.mimeType }),
      }).catch(() => {});
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, display: 'flex' }}>
          <IconSearch size={14} />
        </span>
        <input
          className="select-field"
          style={{ width: '100%', paddingLeft: 32, fontSize: 13 }}
          placeholder="Search across every cloud & device…"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>

      {open && query.trim() && (
        <div
          className="dropdown-menu open"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 360, overflowY: 'auto', zIndex: 50 }}
        >
          {loading && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-tertiary)' }}>Searching…</div>}
          {!loading && results.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-tertiary)' }}>No matches</div>
          )}
          {!loading &&
            results.map((r, i) => (
              <button
                key={`${r.source}-${r.providerId ?? r.deviceId}-${r.folderId ?? ''}-${r.path}-${i}`}
                onClick={() => openResult(r)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 14px', textAlign: 'left' }}
              >
                <span style={{ fontSize: 13 }}>{fileName(r.path)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {r.source === 'cloud' ? '☁️' : '📱'} {r.sourceLabel} · {formatBytes(r.size)}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
