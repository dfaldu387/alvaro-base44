import React from 'react';
import { Pencil, CalendarPlus, Ban } from 'lucide-react';

/**
 * The actions every unresolved booking request offers, so a request Route Flow could not place
 * is never an admin dead end: edit it, place it manually, or decline it.
 *
 * A request Booking Protection is holding is not offered here at all: it cannot be placed until it
 * is approved, so it shows HeldRequestActions instead. Light styling everywhere (the admin standard).
 */
const BASE = 'flex-1 min-w-[96px] min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-white text-xs font-semibold transition-all disabled:opacity-50';
const NORMAL = 'border-zinc-200 text-zinc-600 hover:border-indigo-300 hover:text-indigo-600';
const DECLINE = 'border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-600';

export default function RequestActions({ onEdit, onAddToCalendar, onDecline, disabled = false }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 w-full">
      <button type="button" onClick={onEdit} disabled={disabled} className={`${BASE} ${NORMAL}`}>
        <Pencil className="w-3 h-3" />Edit
      </button>
      <button type="button" onClick={onAddToCalendar} disabled={disabled} className={`${BASE} ${NORMAL}`}>
        <CalendarPlus className="w-3 h-3" />Add to Calendar
      </button>
      <button type="button" onClick={onDecline} disabled={disabled} className={`${BASE} ${DECLINE}`}>
        <Ban className="w-3 h-3" />Decline
      </button>
    </div>
  );
}