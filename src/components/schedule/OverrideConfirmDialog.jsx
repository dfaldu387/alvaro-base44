import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { decimalToLabel } from '@/lib/timeUtils';

/**
 * The warning shown when a placement is otherwise fine but sits outside a rule the
 * customer chose or the booking window allows.
 *
 * Availability is a soft constraint: an administrator may place outside it, but only
 * deliberately. Choosing "Send Confirmation Request" places the appointment as
 * awaiting confirmation and texts the customer the offered time; nothing is written
 * if they cancel. A Booking Window override is the same decision without the message
 * — the customer is not asked about the window.
 */
export default function OverrideConfirmDialog({ prompt, busy = false, onCancel, onConfirm }) {
  if (!prompt) return null;
  const { windowRaw, startDecimal } = prompt;
  const endDecimal = startDecimal + (Number(prompt.durationMins) || 0) / 60;
  const isWindow = prompt.kind === 'window';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40" onClick={busy ? undefined : onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-zinc-900">
              {isWindow ? 'Outside the booking window' : 'Outside customer availability'}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
              {isWindow
                ? `${prompt.message || 'This time is outside the booking window.'} `
                : `The customer selected ${windowRaw || 'a specific window'}. `}
              You are scheduling {prompt.request?.client_name || 'this appointment'} for{' '}
              {decimalToLabel(startDecimal)}–{decimalToLabel(endDecimal)}.
            </p>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              {isWindow
                ? 'Placing it here deliberately overrides the window, and the override is recorded with its reason.'
                : 'The appointment will be held as awaiting confirmation and the customer will be asked whether the time works. Nothing changes if they say no.'}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-lg px-3 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-9 rounded-lg bg-amber-500 px-4 text-xs font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? 'Placing…' : isWindow ? 'Schedule Anyway' : 'Send Confirmation Request'}
          </button>
        </div>
      </div>
    </div>
  );
}