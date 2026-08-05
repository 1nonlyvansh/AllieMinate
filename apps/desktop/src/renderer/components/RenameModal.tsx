import React, { useState } from 'react';
import { Modal } from './Modal';

export function RenameModal({
  currentName,
  onClose,
  onConfirm,
}: {
  currentName: string;
  onClose: () => void;
  onConfirm: (newName: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const invalid = !name.trim() || name.includes('/');

  return (
    <Modal
      title="Rename"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={invalid}
            onClick={() => !invalid && onConfirm(name.trim())}
          >
            Rename
          </button>
        </>
      }
    >
      <input
        className="select-field"
        style={{ width: '100%' }}
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !invalid) onConfirm(name.trim());
        }}
      />
      {name.includes('/') && <div style={{ color: 'var(--offline)', fontSize: 11.5, marginTop: 6 }}>Name can't contain "/"</div>}
    </Modal>
  );
}
