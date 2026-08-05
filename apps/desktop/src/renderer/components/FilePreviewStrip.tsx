import React, { useEffect, useRef, useState } from 'react';
import { IconDocument, IconFiles } from '../icons';

type PreviewKind = 'image' | 'video' | 'pdf' | 'word' | 'text' | 'other';

const WORD_EXT = ['doc', 'docx'];
const TEXT_EXT = ['txt', 'md', 'csv', 'log', 'json'];
const VIDEO_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'];

function previewKindOf(name: string): PreviewKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (WORD_EXT.includes(ext)) return 'word';
  if (TEXT_EXT.includes(ext)) return 'text';
  return 'other';
}

// grabs the first frame of a picked video file into a still image — <video> elements can't be dropped
// into a small thumbnail directly (no controls/scrubbing wanted here), so we seek to a hair past 0 and
// paint that frame onto an offscreen canvas once metadata is available.
function VideoFrameThumb({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      video.currentTime = Math.min(0.1, video.duration || 0);
    };
    const onSeeked = () => {
      const canvas = canvasRef.current;
      if (!canvas || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      setFrameUrl(canvas.toDataURL('image/jpeg', 0.7));
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [url]);

  return (
    <>
      {frameUrl ? (
        <img src={frameUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <video ref={videoRef} src={url} muted playsInline style={{ display: 'none' }} />
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </>
  );
}

function FilePreviewThumb({ file }: { file: File }) {
  const kind = previewKindOf(file.name);
  const [url] = useState(() => URL.createObjectURL(file));
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (kind === 'text') file.slice(0, 300).text().then(setText).catch(() => {});
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (kind === 'image') {
    return <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  if (kind === 'video') {
    return <VideoFrameThumb url={url} />;
  }
  if (kind === 'pdf') {
    return (
      <embed
        src={`${url}#toolbar=0&view=FitH`}
        type="application/pdf"
        style={{ width: '160%', height: '160%', pointerEvents: 'none' }}
      />
    );
  }
  if (kind === 'text') {
    return (
      <div style={{ fontSize: 7, lineHeight: 1.3, padding: 6, overflow: 'hidden', fontFamily: 'ui-monospace, monospace', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
        {text ?? ''}
      </div>
    );
  }
  // Word docs have no reliable client-side thumbnail without a real conversion step — a plain icon here
  // is the honest option rather than a fake-looking placeholder.
  return kind === 'word' ? <IconDocument size={26} /> : <IconFiles size={26} />;
}

export function FilePreviewStrip({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, marginBottom: 4 }}>
      {files.map((file, i) => (
        <div key={`${file.name}-${i}`} style={{ position: 'relative', flexShrink: 0, width: 72 }}>
          <div
            className="glass-card"
            style={{ width: 72, height: 72, borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <FilePreviewThumb file={file} />
          </div>
          <button
            onClick={() => onRemove(i)}
            title="Remove"
            style={{
              position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
              background: 'var(--offline)', color: '#fff', border: '2px solid var(--bg)',
              fontSize: 11, lineHeight: '14px', cursor: 'pointer', padding: 0,
            }}
          >
            ×
          </button>
          <div style={{ fontSize: 10, marginTop: 4, width: 72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }} title={file.name}>
            {file.name}
          </div>
        </div>
      ))}
    </div>
  );
}
