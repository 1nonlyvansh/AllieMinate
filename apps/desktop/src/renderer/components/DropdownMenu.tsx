import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label?: string;
  divider?: boolean;
  danger?: boolean;
  stub?: boolean;
  onClick?: () => void;
}

const MENU_W = 208;
// clicking a second kebab calls stopPropagation (needed so it doesn't also trigger the card's own
// onClick), which means that click never reaches document — so a plain document-click "close on
// outside click" listener never fires for any OTHER already-open menu. Broadcast a custom event instead,
// which every instance listens for regardless of its own open state.
const CLOSE_ALL_EVENT = 'alliminate:closeDropdowns';

export function DropdownMenu({ items, trigger }: { items: MenuItem[]; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const closeSelf = () => setOpen(false);
    window.addEventListener(CLOSE_ALL_EVENT, closeSelf);
    return () => window.removeEventListener(CLOSE_ALL_EVENT, closeSelf);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const willOpen = !open;
    if (willOpen && btnRef.current) {
      window.dispatchEvent(new Event(CLOSE_ALL_EVENT));
      const rect = btnRef.current.getBoundingClientRect();
      let left = Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8);
      left = Math.max(left, 8);
      let top = rect.bottom + 4;
      if (top + 280 > window.innerHeight) top = rect.top - 284;
      setPos({ top, left });
    }
    setOpen(willOpen);
  }

  return (
    <div className="menu-wrap">
      <button ref={btnRef} className={trigger ? 'tray-icon-btn' : 'kebab-btn'} onClick={toggle}>
        {trigger ?? '⋯'}
      </button>
      {open &&
        createPortal(
          <div
            className="dropdown-menu open"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item, i) =>
              item.divider ? (
                <div key={i} className="menu-divider" />
              ) : (
                <button
                  key={i}
                  className={item.danger ? 'danger' : ''}
                  onClick={() => {
                    item.onClick?.();
                    setOpen(false);
                  }}
                >
                  {item.label}
                  {item.stub && <span className="stub-tag">soon</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
