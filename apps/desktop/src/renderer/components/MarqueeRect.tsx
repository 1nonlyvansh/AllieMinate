import React from 'react';
import { createPortal } from 'react-dom';
import type { MarqueeRect as MarqueeRectValue } from '../lib/useMarqueeSelect';

/** Portaled to document.body for the same reason Modal.tsx is — an ancestor with backdrop-filter (every
 * .glass-card in this app) becomes the containing block for a position:fixed descendant otherwise, which
 * would pin the rectangle to the wrong place instead of tracking the real cursor position on screen. */
export function MarqueeRect({ rect }: { rect: MarqueeRectValue | null }) {
  if (!rect) return null;
  return createPortal(
    <div
      className="marquee-select"
      style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />,
    document.body,
  );
}
