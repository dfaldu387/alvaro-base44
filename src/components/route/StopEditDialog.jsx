import React from 'react';
import { X } from 'lucide-react';
import BookingEditForm from '@/components/schedule/edit/BookingEditForm';

/**
 * Edit Booking, opened from a Route card. This is the Calendar's own editor —
 * the same form, the same endpoints, the same permission checks — shown over the
 * timeline instead of inside the Calendar's side drawer.
 */
export default function StopEditDialog({ stop, onClose, onSaved, onAddToast }) {
  if (!stop) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 lg:items-center" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-zinc-200 bg-white shadow-2xl lg:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-zinc-900">Edit booking</p>
            <p className="truncate text-[11px] text-zinc-500">{stop.clientName}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200">
            <X className="h-3.5 w-3.5 text-zinc-500" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <BookingEditForm appt={stop} onCancel={onClose} onSaved={onSaved} onAddToast={onAddToast} />
        </div>
      </div>
    </div>
  );
}