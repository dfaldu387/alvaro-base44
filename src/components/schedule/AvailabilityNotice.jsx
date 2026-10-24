import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * The result of a placement outside the client's preferred availability: the
 * appointment is already saved, and the client is being asked to confirm the new
 * time. Deliberately a quiet amber bar rather than a modal — nothing is waiting on
 * the barber, and the day stays editable underneath it.
 */
export default function AvailabilityNotice({ notice, onDismiss }) {
  if (!notice) return null;
  return (
    <div className="cal-rise flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 sm:px-6">
      <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold leading-snug text-amber-900">
          {notice.title || 'Placed outside preferred availability'}
        </p>
        <p className="text-[11px] leading-snug text-amber-700">
          {notice.detail || 'A confirmation SMS will be sent to the client.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-100 hover:text-amber-800"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}