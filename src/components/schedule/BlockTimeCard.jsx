import React, { useRef, useState } from 'react';
import { Ban, Pencil, Repeat, Trash2 } from 'lucide-react';
import { decimalToLabel, snapTo5 } from '@/lib/timeUtils';
import { blockReason } from '@/lib/blockTime';
import TimeBlockMenu from '@/components/schedule/TimeBlockMenu';
import { cn } from '@/lib/utils';

/**
 * A blocked-time block (Lunch, Personal, Unavailable …) on either calendar view.
 *
 * Deliberately a sibling of the appointment card, not a cousin: the same radius, the
 * same padding, the same three-dot menu in the same corner — but a pale blue-lavender
 * fill with a dashed edge and a blocked-time icon, so a barber can tell the two apart
 * at a glance without either looking greyed out or heavy.
 *
 * Everything on it is interactive: drag the body to move it, drag the bottom edge to
 * resize it (both snap to the calendar's 5-minute step and show the time they will
 * land on), tap it to open its menu, or use the menu directly.
 */
const PX_PER_HOUR = 120;

export default function BlockTimeCard({
  appt, topPx, heightPx, hourStart, hourEnd, insetClass = 'left-1 right-1',
  onCommit, onEdit, onDelete, readOnly = false,
}) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const title = blockReason(appt);
  const start = drag ? drag.start : appt.apptStart;
  const end = drag ? drag.end : appt.apptEnd;
  const offset = (start - appt.apptStart) * PX_PER_HOUR;
  const height = Math.max((end - start) * PX_PER_HOUR, 24);
  const tiny = heightPx < 40;

  const menuItems = [
    { label: 'Edit block', icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => onEdit?.(appt) },
    { label: 'Delete block', icon: <Trash2 className="h-3.5 w-3.5" />, onSelect: () => onDelete?.(appt), danger: true },
  ];

  /**
   * Move or resize. Both are previews until the pointer is released: the card follows
   * the pointer (in 5-minute steps) and shows the time it would land on, then asks the
   * Calendar to save it. Nothing is written here.
   */
  const beginDrag = (event, mode) => {
    if (readOnly) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const column = ref.current?.parentElement;
    if (!column) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = column.getBoundingClientRect();
    const origin = { start: appt.apptStart, end: appt.apptEnd };
    const startedAt = event.clientY;
    let latest = origin;
    let moved = false;
    const timeAt = (y) => snapTo5((y - rect.top) / PX_PER_HOUR + hourStart);

    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientY - startedAt) < 3) return;
      moved = true;
      if (mode === 'move') {
        const dur = origin.end - origin.start;
        const nextStart = Math.max(hourStart, Math.min(hourEnd - dur, timeAt(ev.clientY)));
        latest = { start: nextStart, end: nextStart + dur };
      } else {
        const nextEnd = Math.max(origin.start + 5 / 60, Math.min(hourEnd, timeAt(ev.clientY)));
        latest = { start: origin.start, end: nextEnd };
      }
      setDrag(latest);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (!moved) {
        // A tap on the block is how its actions are reached on a touch screen.
        setMenuOpen(true);
        return;
      }
      if (Math.abs(latest.start - origin.start) > 1e-6 || Math.abs(latest.end - origin.end) > 1e-6) {
        onCommit?.(appt, latest.start, latest.end);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={ref}
      data-appt
      data-block
      onPointerDown={(e) => beginDrag(e, 'move')}
      className={cn(
        'absolute z-10 flex overflow-hidden rounded-lg border border-dashed border-indigo-300 bg-indigo-50',
        'shadow-[0_1px_2px_rgba(49,46,129,0.07)] transition-shadow',
        drag ? 'z-30 border-indigo-500 bg-indigo-100 shadow-md' : 'hover:shadow-sm',
        readOnly ? 'cursor-default' : 'cursor-grab',
        insetClass,
      )}
      style={{ top: topPx + offset, height, touchAction: 'none' }}
      title={`${title} · ${decimalToLabel(start)}–${decimalToLabel(end)}`}
    >
      <div className={cn('flex min-w-0 flex-1 items-start gap-1.5 px-2', tiny ? 'py-[3px]' : 'py-1')}>
        <Ban className="mt-[2px] h-3 w-3 shrink-0 text-indigo-500" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className={cn(
              'truncate font-semibold leading-tight text-[#1e1b4b]',
              tiny ? 'text-[11px]' : 'text-[12px]',
            )}>
              {title}
            </span>
            {appt.series_id && <Repeat className="h-2.5 w-2.5 shrink-0 text-indigo-400" />}
          </div>
          {!tiny && (
            <span className="block truncate text-[10px] font-medium leading-tight tabular-nums text-indigo-600">
              {decimalToLabel(start)}–{decimalToLabel(end)}
            </span>
          )}
          {tiny && (
            <span className="block truncate text-[9px] font-medium leading-tight tabular-nums text-indigo-600">
              {decimalToLabel(start)}–{decimalToLabel(end)}
            </span>
          )}
        </div>
        {!readOnly && (
          <TimeBlockMenu
            items={menuItems}
            label={`${title} actions`}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            className="text-indigo-500 hover:bg-white/70 hover:text-indigo-800"
          />
        )}
      </div>

      {/* The bottom edge resizes the block. Its own pointer target, so it never starts
          a move by accident. */}
      {!readOnly && (
        <span
          role="separator"
          aria-label="Resize block"
          onPointerDown={(e) => beginDrag(e, 'resize')}
          className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize items-center justify-center"
        >
          <span className="h-[3px] w-6 rounded-full bg-indigo-300" />
        </span>
      )}
    </div>
  );
}