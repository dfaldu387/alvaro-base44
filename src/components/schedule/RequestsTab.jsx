import React from 'react';
import { ChevronLeft, Inbox } from 'lucide-react';

/**
 * The collapsed Booking Requests tab — a thin strip on the far-right edge of the
 * Calendar workspace, visible at all times.
 *
 * It is the door to the requests column, and the only way the panel is opened:
 * the panel never appears as a side effect of choosing a day, so a request can be
 * read on one day while the calendar stays exactly where it was.
 */
export default function RequestsTab({ count = 0, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open Booking Requests"
      aria-label={`Open Booking Requests${count > 0 ? ` (${count} waiting)` : ''}`}
      className="group flex w-10 shrink-0 flex-col items-center gap-2.5 border-l border-[#4f46e5] bg-[#6366f1] py-4 transition-colors hover:bg-[#5851e0]"
    >
      <ChevronLeft className="h-3.5 w-3.5 text-white/70 transition-transform group-hover:-translate-x-0.5" />
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15">
        <Inbox className="h-3.5 w-3.5 text-white" />
      </span>
      {count > 0 && (
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-bold tabular-nums text-[#4f46e5]">
          {count}
        </span>
      )}
      <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-white">
        Booking Requests
      </span>
    </button>
  );
}