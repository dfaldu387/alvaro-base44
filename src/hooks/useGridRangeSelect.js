import { useCallback, useRef, useState } from 'react';
import { snapTo5 } from '@/lib/timeUtils';

const MIN_DRAG_MINS = 15;

/**
 * Click and drag over a calendar's empty timeline to pick a time range.
 *
 * Returns the range being dragged (for the translucent preview) and a pointer
 * handler to attach to a day column or the day planner. A plain click is reported
 * with `end: null` so the caller can keep its existing "open at this time"
 * behaviour; anything dragged is reported as a start and an end. Nothing about the
 * booking's real duration is decided here — the service catalogue is.
 */
export default function useGridRangeSelect({ pxPerHour, hourStart, hourEnd, enabled = true, onSelect }) {
  const [preview, setPreview] = useState(null);
  // A drag also fires a click when it ends; the caller skips that one click.
  const justDragged = useRef(false);
  const cleanupRef = useRef(null);

  const onPointerDown = useCallback((event, meta) => {
    // Touch keeps the existing hold-to-create gesture: a vertical touch drag is the
    // timeline scrolling, never a range.
    if (!enabled || event.button !== 0 || event.pointerType === 'touch') return;
    if (event.target.closest('[data-appt]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const decimalAt = (clientY) => {
      const raw = (clientY - rect.top) / pxPerHour + hourStart;
      return Math.max(hourStart, Math.min(hourEnd, snapTo5(raw)));
    };
    const anchor = decimalAt(event.clientY);
    let dragged = false;
    cleanupRef.current?.();

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
    };

    function onMove(moveEvent) {
      const now = decimalAt(moveEvent.clientY);
      if (Math.abs(now - anchor) * 60 >= 5) dragged = true;
      if (!dragged) return;
      justDragged.current = true;
      setPreview({ index: meta, start: Math.min(anchor, now), end: Math.max(anchor, now) });
    }

    function onUp(upEvent) {
      cleanup();
      const now = decimalAt(upEvent.clientY);
      const start = Math.min(anchor, now);
      const end = Math.max(anchor, now);
      setPreview(null);
      if (dragged && (end - start) * 60 >= MIN_DRAG_MINS) onSelect?.({ start, end, meta });
      else onSelect?.({ start: anchor, end: null, meta });
      // The click that follows this pointerup is part of the same gesture.
      if (dragged) setTimeout(() => { justDragged.current = false; }, 0);
    }

    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [enabled, pxPerHour, hourStart, hourEnd, onSelect]);

  return { preview, onPointerDown, justDragged };
}