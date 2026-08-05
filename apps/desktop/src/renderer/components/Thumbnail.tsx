import React, { useEffect, useRef, useState } from 'react';
import { categorize } from '../lib/format';
import { docxToHtml } from '../lib/docx';

const API_BASE = 'http://localhost:4310';
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
const MAX_DOCX_PREVIEW_BYTES = 5 * 1024 * 1024;
const blobCache = new Map<string, string>();
const docxHtmlCache = new Map<string, string>();
const loadedThumbCache = new Set<string>();

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
};

const MAX_VIDEO_PREVIEW_BYTES = 60 * 1024 * 1024;

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? '';
}

/** Grabs the first frame of a video blob as a data URL — plays it in a hidden (but DOM-attached — some
 * engines won't reliably decode/seek a fully detached element) <video>, seeks past frame 0 so black
 * opening frames aren't captured, then reads the frame into a <canvas>. Same-origin (blob:), so canvas
 * export never hits a CORS taint. A timeout guards against a video that never fires its events. */
function captureVideoFrame(blobUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed; top:-9999px; left:-9999px; width:1px; height:1px;';
    document.body.appendChild(video);

    let settled = false;
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      video.remove();
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      cleanup();
    };

    const timer = setTimeout(() => finish(() => reject(new Error('video preview timed out'))), 8000);

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(0.3, (video.duration || 1) / 2);
    });
    video.addEventListener('seeked', () => {
      finish(() => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 300;
          canvas.height = video.videoHeight || 300;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no canvas context');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (err) {
          reject(err);
        }
      });
    });
    video.addEventListener('error', () => {
      finish(() => reject(new Error('video decode failed')));
    });

    video.src = blobUrl;
  });
}

function extLabel(name: string): string {
  return (name.split('.').pop() ?? '').slice(0, 4).toUpperCase();
}

export function Thumbnail({
  folderId,
  providerId,
  fileKey,
  name,
  size = 0,
  thumbnailUrl,
  directUrl,
}: {
  folderId?: string;
  providerId?: string;
  fileKey: string;
  name: string;
  size?: number;
  /** Drive-generated server-side preview (pdf/docx/pptx/xlsx/video/images alike) — when present, this is
   * used directly and none of the client-side download/render machinery below runs at all. */
  thumbnailUrl?: string;
  /** Bypasses the folderId/providerId → download-URL construction below — for a source that's neither a
   * pinned folder nor a cloud provider (the local "This Mac" recent-files strip, which has its own
   * /local/download?path= route). fileKey still doubles as the cache key when this is set. */
  directUrl?: string;
}) {
  const cacheKey = `${directUrl ? `d:${directUrl}` : providerId ? `p:${providerId}` : `f:${folderId}`}:${fileKey}`;
  const downloadUrl = directUrl ?? (providerId
    ? `${API_BASE}/providers/${providerId}/download?key=${encodeURIComponent(fileKey)}`
    : `${API_BASE}/folders/${folderId}/download?key=${encodeURIComponent(fileKey)}`);
  const [url, setUrl] = useState<string | null>(blobCache.get(cacheKey) ?? null);
  const [docxHtml, setDocxHtml] = useState<string | null>(docxHtmlCache.get(cacheKey) ?? null);
  const [remoteThumbFailed, setRemoteThumbFailed] = useState(false);
  // loadedThumbCache tracks which thumbnailUrls have already finished loading once — reused so a second
  // render of the same file (e.g. scrolling the tray list, switching tabs and back) shows the image
  // immediately instead of blanking out again while the browser re-fetches from its own HTTP cache.
  const [remoteThumbLoaded, setRemoteThumbLoaded] = useState(() => !!thumbnailUrl && loadedThumbCache.has(thumbnailUrl));
  const ref = useRef<HTMLDivElement>(null);

  const hasRemoteThumb = !!thumbnailUrl && !remoteThumbFailed;

  const mime = guessMime(name);
  const kind =
    mime.startsWith('image/') ? 'image' :
    mime.startsWith('video/') ? 'video' :
    mime === 'application/pdf' ? 'pdf' :
    mime === MIME_BY_EXT.docx ? 'docx' : 'other';
  const category = categorize(name);
  const docxTooBig = kind === 'docx' && size > MAX_DOCX_PREVIEW_BYTES;
  const sizeCap = kind === 'video' ? MAX_VIDEO_PREVIEW_BYTES : MAX_PREVIEW_BYTES;

  useEffect(() => {
    if (hasRemoteThumb || kind === 'other' || docxTooBig || url || docxHtml || (size && size > sizeCap)) return;
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        fetch(downloadUrl)
          .then((res) => res.arrayBuffer())
          .then(async (buf) => {
            if (kind === 'docx') {
              const html = await docxToHtml(buf);
              docxHtmlCache.set(cacheKey, html);
              setDocxHtml(html);
            } else if (kind === 'video') {
              const blobUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
              try {
                const frameUrl = await captureVideoFrame(blobUrl);
                blobCache.set(cacheKey, frameUrl);
                setUrl(frameUrl);
              } finally {
                URL.revokeObjectURL(blobUrl);
              }
            } else {
              const blobUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
              blobCache.set(cacheKey, blobUrl);
              setUrl(blobUrl);
            }
          })
          .catch(() => {});
      },
      { rootMargin: '250px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasRemoteThumb, downloadUrl, kind, url, docxHtml, docxTooBig, size, sizeCap, mime, cacheKey]);

  const showFallback =
    (hasRemoteThumb && !remoteThumbLoaded) ||
    (!hasRemoteThumb &&
      (kind === 'other' ||
        (kind === 'docx' && (docxTooBig || !docxHtml)) ||
        ((kind === 'image' || kind === 'pdf' || kind === 'video') && !url)));

  return (
    <div ref={ref} className="thumb-wrap">
      {/* the fallback badge renders UNDERNEATH and stays mounted until the real thumbnail has actually
          painted — previously the remote-thumbnail <img> was the only thing rendered while it loaded, so
          the card sat blank for however long the network fetch took, then the image popped in all at once.
          This way something is visible immediately and the swap is a fade instead of a blank-then-pop. */}
      {showFallback && <span className={`thumb-fallback type-${category}`}>{extLabel(name) || '?'}</span>}
      {hasRemoteThumb && (
        <img
          src={thumbnailUrl}
          className={`thumb-img${remoteThumbLoaded ? ' loaded' : ' loading'}`}
          alt=""
          onLoad={() => {
            if (thumbnailUrl) loadedThumbCache.add(thumbnailUrl);
            setRemoteThumbLoaded(true);
          }}
          onError={() => setRemoteThumbFailed(true)}
        />
      )}
      {!hasRemoteThumb && url && (kind === 'image' || kind === 'video') && <img src={url} className="thumb-img loaded" alt="" />}
      {!hasRemoteThumb && url && kind === 'pdf' && <embed src={`${url}#toolbar=0&view=FitH`} type="application/pdf" className="thumb-pdf" />}
      {!hasRemoteThumb && docxHtml && kind === 'docx' && !docxTooBig && (
        <div className="thumb-docx" dangerouslySetInnerHTML={{ __html: docxHtml }} />
      )}
    </div>
  );
}
