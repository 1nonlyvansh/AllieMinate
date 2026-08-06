import React, { useState } from 'react';
import { Modal } from './Modal';
import { deviceNounLower } from '../lib/platformLabels';

const API_BASE = 'http://localhost:4310';
const MAX_IMAGES = 5;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function RecordLogModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [saving, setSaving] = useState(false);

  async function addImages(files: FileList | null) {
    if (!files) return;
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).slice(0, room);
    const read = await Promise.all(picked.map(async (f) => ({ name: f.name, dataUrl: await readAsDataUrl(f) })));
    setImages((prev) => [...prev, ...read]);
  }

  async function submit() {
    if (!description.trim()) return;
    setSaving(true);
    await fetch(`${API_BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description.trim(), images }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <Modal
      title="Record Error Log to System"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!description.trim() || saving} onClick={submit}>
            {saving ? 'Saving…' : 'Save Log'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 10 }}>
        Describe what went wrong — this gets saved to a log file on {deviceNounLower} that you can send us from the Error Logs section below.
      </div>

      <textarea
        className="select-field"
        style={{ width: '100%', minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }}
        placeholder="What happened?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        autoFocus
      />

      <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
        Screenshots ({images.length}/{MAX_IMAGES})
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {images.map((img, i) => (
          <div key={i} style={{ position: 'relative', width: 60, height: 60 }}>
            <img src={img.dataUrl} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8 }} />
            <button
              onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
              style={{
                position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                background: 'var(--offline)', color: '#fff', border: '2px solid var(--bg)',
                fontSize: 11, lineHeight: '14px', cursor: 'pointer', padding: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <label
            style={{
              width: 60, height: 60, borderRadius: 8, border: '1.5px dashed var(--hairline)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, color: 'var(--text-tertiary)',
            }}
          >
            +
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addImages(e.target.files)} />
          </label>
        )}
      </div>
    </Modal>
  );
}
