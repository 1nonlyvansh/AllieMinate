import { useCallback, useRef, useState } from 'react';

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Finder/Explorer-style drag-rectangle multi-select. Attach `containerRef` to the scrollable grid/table
 * wrapper and `onMouseDown` to that same element; tag every selectable row/card with `data-select-id`.
 * Plain drag selects only what the rectangle currently covers (live, as it grows) — Shift/Cmd/Ctrl held
 * at drag-start adds newly-covered items to whatever was already selected instead of replacing it. A
 * plain click on empty background (mousedown+mouseup with no real movement) clears the selection, same
 * as clicking empty Finder whitespace. Clicking directly on an item is left alone entirely — the click
 * handler already on that item (single/cmd/shift-click selection) runs as normal. */
export function useMarqueeSelect(getSelected: () => Set<string>, setSelected: (next: Set<string>) => void) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-select-id]')) return;
      // without this, dragging over card thumbnails/filenames triggers the browser's native
      // text/image drag-selection alongside (or instead of) the marquee rectangle.
      e.preventDefault();
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      const base = additive ? getSelected() : new Set<string>();
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;

      function onMove(ev: MouseEvent) {
        // a few pixels of slop before it counts as a real drag, so a slightly-jittery click doesn't
        // spuriously clear the selection in the mouseup handler below
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
        moved = true;
        const left = Math.min(startX, ev.clientX);
        const top = Math.min(startY, ev.clientY);
        const width = Math.abs(ev.clientX - startX);
        const height = Math.abs(ev.clientY - startY);
        setMarquee({ left, top, width, height });

        const container = containerRef.current;
        if (!container) return;
        const next = new Set(base);
        container.querySelectorAll<HTMLElement>('[data-select-id]').forEach((el) => {
          const r = el.getBoundingClientRect();
          const hit = !(r.right < left || r.left > left + width || r.bottom < top || r.top > top + height);
          if (hit) next.add(el.dataset.selectId!);
        });
        setSelected(next);
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setMarquee(null);
        if (!moved && !additive) setSelected(new Set());
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [getSelected, setSelected],
  );

  return { containerRef, marquee, onMouseDown };
}
