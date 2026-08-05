import React, { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format';
import { docxToHtml } from '../lib/docx';
import { Modal } from './Modal';

export interface PreviewTarget {
  /** where to download bytes from — either a synced folder or a raw provider browse */
  source: { kind: 'folder'; folderId: string } | { kind: 'provider'; providerId: string };
  key: string;
  name: string;
  size: number;
  provider: string;
  folderName: string;
  modifiedAt: string;
  hash: string;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/plain', json: 'application/json', log: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function PreviewModal({
  file,
  apiBase,
  onClose,
}: {
  file: PreviewTarget;
  apiBase: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textBody, setTextBody] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);

  const mime = guessMime(file.name);
  const kind =
    mime.startsWith('image/') ? 'image' :
    mime === 'application/pdf' ? 'pdf' :
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'docx' :
    (mime.startsWith('text/') || mime === 'application/json') ? 'text' : 'other';

  const downloadUrl =
    file.source.kind === 'folder'
      ? `${apiBase}/folders/${file.source.folderId}/download?key=${encodeURIComponent(file.key)}`
      : `${apiBase}/providers/${file.source.providerId}/download?key=${encodeURIComponent(file.key)}`;

  useEffect(() => {
    if (kind === 'other') {
      setStatus('ready');
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setStatus('loading');

    fetch(downloadUrl)
      .then((res) => {
        if (!res.ok) throw new Error('download failed');
        return res.arrayBuffer();
      })
      .then(async (buf) => {
        if (cancelled) return;
        if (kind === 'text') {
          setTextBody(new TextDecoder().decode(buf).slice(0, 20000));
        } else if (kind === 'docx') {
          const html = await docxToHtml(buf);
          if (cancelled) return;
          setDocxHtml(html);
        } else {
          const blob = new Blob([buf], { type: mime });
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
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

  const big = kind === 'image' || kind === 'pdf' || kind === 'docx';

  return (
    <Modal title={file.name} onClose={onClose} size={big ? 'lg' : undefined} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className={`preview-area${big ? ' preview-area-lg' : ''}`}>
        {status === 'loading' && <div className="empty-state">Loading preview…</div>}
        {status === 'error' && <div className="empty-state">Couldn't load preview</div>}
        {status === 'ready' && kind === 'image' && blobUrl && (
          <img src={blobUrl} style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 8, display: 'block', margin: '0 auto' }} />
        )}
        {status === 'ready' && kind === 'pdf' && blobUrl && (
          <embed src={`${blobUrl}#toolbar=1&view=FitH`} type="application/pdf" style={{ width: '100%', height: '65vh', border: 'none', borderRadius: 8 }} />
        )}
        {status === 'ready' && kind === 'docx' && docxHtml && (
          <div
            className="preview-docx"
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        )}
        {status === 'ready' && kind === 'text' && <pre className="preview-text">{textBody}</pre>}
        {status === 'ready' && kind === 'other' && <div className="empty-state">No inline preview for this file type yet</div>}
      </div>

      <table className="prop-table">
        <tbody>
          <tr><td>Name</td><td>{file.name}</td></tr>
          <tr><td>Size</td><td>{formatBytes(file.size)}</td></tr>
          <tr><td>Folder</td><td>{file.folderName}</td></tr>
          <tr><td>Cloud provider</td><td>{file.provider}</td></tr>
          <tr><td>Last modified</td><td>{new Date(file.modifiedAt).toLocaleString()}</td></tr>
          <tr><td>Checksum</td><td>{file.hash || '—'}</td></tr>
        </tbody>
      </table>
    </Modal>
  );
}
