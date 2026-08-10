import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBytes } from '../lib/format';
import {
  IconZoomIn, IconZoomOut, IconRotateLeft, IconRotateRight, IconDownload, IconInfo,
  IconExternalLink, IconPlay, IconPause, IconVolume, IconVolumeMuted, IconClose,
} from '../icons';

export interface PreviewTarget {
  /** where to download bytes from — a synced folder, a raw provider browse, or a paired device's own
   * folders/local-folders proxy route */
  source:
    | { kind: 'folder'; folderId: string }
    | { kind: 'provider'; providerId: string }
    | { kind: 'device'; deviceId: string; apiSegment: 'folders' | 'local-folders' | 'sync-pairs'; folderId: string }
    | { kind: 'photo'; accountId: string; baseUrl: string };
  key: string;
  name: string;
  size: number;
  provider: string;
  folderName: string;
  modifiedAt: string;
  hash: string;
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'heif', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', m4v: 'video/x-m4v',
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function guessMime(name: string): string {
  return MIME_BY_EXT[extOf(name)] ?? 'application/octet-stream';
}

/** Only image and video get an inline render — everything else (audio, PDF, Word, PPT, ...) is a
 * deliberate non-goal here; those always open in their native app instead. See callers' click handlers,
 * which route non-image/video files straight to onOpenInApp and never construct a PreviewTarget for them. */
function kindOf(name: string): 'image' | 'video' | 'other' {
  const ext = extOf(name);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'other';
}

function fmtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PreviewModal({
  file,
  apiBase,
  onClose,
  onOpenInApp,
}: {
  file: PreviewTarget;
  apiBase: string;
  onClose: () => void;
  onOpenInApp?: () => void;
}) {
  const kind = kindOf(file.name);
  const mime = guessMime(file.name);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const downloadUrl =
    file.source.kind === 'folder'
      ? `${apiBase}/folders/${file.source.folderId}/download?key=${encodeURIComponent(file.key)}`
      : file.source.kind === 'provider'
        ? `${apiBase}/providers/${file.source.providerId}/download?key=${encodeURIComponent(file.key)}`
        : file.source.kind === 'photo'
          // "download=1" is the full-quality fetch this same route already serves to the Download button —
          // reused here so the lightbox shows the real photo/video, not a 300x300 picker thumbnail crop.
          ? `${apiBase}/photos/${file.source.accountId}/thumbnail?url=${encodeURIComponent(file.source.baseUrl)}&download=1&filename=${encodeURIComponent(file.name)}`
          : `${apiBase}/devices/${file.source.deviceId}/${file.source.apiSegment}/${file.source.folderId}/download?key=${encodeURIComponent(file.key)}`;

  useEffect(() => {
    if (kind === 'other') {
      setStatus('ready');
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setStatus('loading');
    setZoom(1);
    setRotation(0);

    fetch(downloadUrl)
      .then((res) => {
        if (!res.ok) throw new Error('download failed');
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        const blob = new Blob([buf], { type: mime });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [downloadUrl]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function download() {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = file.name;
    a.click();
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function setSpeedTo(s: number) {
    const v = videoRef.current;
    if (v) v.playbackRate = s;
    setSpeed(s);
    setShowSpeedMenu(false);
  }

  function scrub(t: number) {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setCurrentTime(t);
  }

  return createPortal(
    <div className="preview-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preview-shell">
        <div className="preview-topbar">
          <div className="preview-topbar-left">
            <button className="preview-icon-btn" onClick={onClose} title="Close">
              <IconClose size={16} />
            </button>
            <span className="preview-filename">{file.name}</span>
          </div>

          {kind === 'image' && status === 'ready' && (
            <div className="preview-topbar-center">
              <button className="preview-icon-btn" onClick={() => setZoom((z) => Math.min(z + 0.25, 4))} title="Zoom In">
                <IconZoomIn size={16} />
              </button>
              <button className="preview-icon-btn" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))} title="Zoom Out">
                <IconZoomOut size={16} />
              </button>
              <button className="preview-icon-btn" onClick={() => setRotation((r) => (r - 90 + 360) % 360)} title="Rotate Left">
                <IconRotateLeft size={16} />
              </button>
              <button className="preview-icon-btn" onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate Right">
                <IconRotateRight size={16} />
              </button>
              <button className="preview-icon-btn" onClick={download} title="Download">
                <IconDownload size={16} />
              </button>
              <button
                className={`preview-icon-btn${showDetails ? ' active' : ''}`}
                onClick={() => setShowDetails((v) => !v)}
                title="Details"
              >
                <IconInfo size={16} />
              </button>
            </div>
          )}

          <div className="preview-topbar-right">
            {onOpenInApp && (
              <button className="btn primary small" onClick={onOpenInApp}>
                <IconExternalLink size={14} /> Open in App
              </button>
            )}
          </div>
        </div>

        <div className="preview-body">
          <div className="preview-stage">
            {status === 'loading' && <div className="empty-state">Loading preview…</div>}
            {status === 'error' && <div className="empty-state">Couldn't load preview</div>}

            {status === 'ready' && kind === 'image' && blobUrl && (
              <img
                src={blobUrl}
                className="preview-image"
                style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
              />
            )}

            {status === 'ready' && kind === 'video' && blobUrl && (
              <div className="preview-video-wrap" onClick={togglePlay}>
                <video
                  ref={videoRef}
                  src={blobUrl}
                  className="preview-video"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
                <div className="preview-video-controls" onClick={(e) => e.stopPropagation()}>
                  <button className="preview-icon-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
                    {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
                  </button>
                  <button className="preview-icon-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
                    {muted ? <IconVolumeMuted size={16} /> : <IconVolume size={16} />}
                  </button>
                  <span className="preview-video-time">{fmtTime(currentTime)}</span>
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => scrub(Number(e.target.value))}
                    className="preview-video-timeline"
                  />
                  <span className="preview-video-time">{fmtTime(duration)}</span>
                  <div className="preview-speed-wrap">
                    <button className="preview-speed-btn" onClick={() => setShowSpeedMenu((v) => !v)}>
                      {speed}x
                    </button>
                    {showSpeedMenu && (
                      <div className="preview-speed-menu">
                        {SPEEDS.map((s) => (
                          <button
                            key={s}
                            className={`preview-speed-option${s === speed ? ' active' : ''}`}
                            onClick={() => setSpeedTo(s)}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {status === 'ready' && kind === 'other' && (
              <div className="empty-state">
                No inline preview for this file type.
                {onOpenInApp && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn primary small" onClick={onOpenInApp}>Open in App</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {showDetails && kind === 'image' && (
            <div className="preview-details-panel">
              <h3>Details</h3>
              <table className="prop-table">
                <tbody>
                  <tr><td>Name</td><td>{file.name}</td></tr>
                  <tr><td>Size</td><td>{formatBytes(file.size)}</td></tr>
                  <tr><td>Folder</td><td>{file.folderName}</td></tr>
                  <tr><td>Cloud provider</td><td>{file.provider}</td></tr>
                  <tr><td>Last modified</td><td>{new Date(file.modifiedAt).toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
