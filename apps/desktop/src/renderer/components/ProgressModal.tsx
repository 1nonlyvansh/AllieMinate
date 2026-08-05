import React from 'react';
import { Modal } from './Modal';

export function ProgressModal({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Modal title={label} onClose={() => {}}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ width: '100%', height: 8, borderRadius: 999, background: 'var(--hairline)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 999, background: 'var(--accent)', width: `${pct}%`, transition: 'width 0.2s ease' }} />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', textAlign: 'right' }}>{done}/{total}</div>
      </div>
    </Modal>
  );
}
