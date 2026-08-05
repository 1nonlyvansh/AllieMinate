import React from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'lg';
}) {
  // Portaled to document.body rather than rendered in place — any ancestor with backdrop-filter/filter/
  // transform (every .glass-card in this app has backdrop-filter for the glass effect) becomes the
  // containing block for a position:fixed descendant instead of the viewport, per the CSS spec. A modal
  // opened from a control that happens to live inside a glass-card (App Lock's "Set a PIN," among others)
  // was rendering fixed-relative-to-that-card — small, low in the page, and stacking BEHIND unrelated
  // content — instead of centered over the whole window. Escaping to body sidesteps the trap entirely
  // rather than depending on every call site avoiding glass-card ancestors.
  return createPortal(
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${size === 'lg' ? ' modal-lg' : ''}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
