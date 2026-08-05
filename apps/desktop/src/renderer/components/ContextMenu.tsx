import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { MenuItem } from './DropdownMenu';

const MENU_W = 208;

export function ContextMenu({
  pos,
  items,
  onClose,
}: {
  pos: { top: number; left: number } | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!pos) return;
    document.addEventListener('click', onClose);
    document.addEventListener('contextmenu', onClose);
    return () => {
      document.removeEventListener('click', onClose);
      document.removeEventListener('contextmenu', onClose);
    };
  }, [pos, onClose]);

  if (!pos) return null;

  const left = Math.min(pos.left, window.innerWidth - MENU_W - 8);
  const top = Math.min(pos.top, window.innerHeight - 280);

  return createPortal(
    <div className="dropdown-menu open" style={{ top, left }} onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="menu-divider" />
        ) : (
          <button
            key={i}
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          >
            {item.label}
            {item.stub && <span className="stub-tag">soon</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
