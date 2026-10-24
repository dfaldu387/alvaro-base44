import React from 'react';
import { Loader2, MessageSquare } from 'lucide-react';

/**
 * Confirm this day? — the one step of connecting a day that reaches every client.
 *
 * It fixes each appointment's time and queues its confirmation message, so it is
 * the only part of the connect flow a person cannot undo by hand. It therefore
 * states exactly who it will reach before it does anything.
 */
export default function ConfirmAppointmentsDialog({ open, dateLabel, count = 0, busy = false, onCancel, onConfirm }) {
  if (!open) return null;
  const none = count === 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40" onClick={busy ? undefined : onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-violet-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100">
            <MessageSquare className="h-4 w-4 text-violet-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-zinc-900">Confirm {dateLabel}&rsquo;s appointments?</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {none
                ? 'There is nothing on this day to confirm.'
                : `${count} client${count === 1 ? '' : 's'} will be sent a confirmation message with their appointment time.`}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Each time is then fixed: Route Flow will no longer move it, and the day reads as confirmed.
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
            disabled={busy || none}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#6366f1] px-4 text-xs font-bold text-white transition-colors hover:bg-[#5851e0] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
            {busy ? 'Confirming…' : count === 1 ? 'Send 1 confirmation' : `Send ${count} confirmations`}
          </button>
        </div>
      </div>
    </div>
  );
}