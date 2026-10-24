import React, { useState } from 'react';
import { Ban } from 'lucide-react';
import SeriesScopeField from '@/components/schedule/SeriesScopeField';
import { blockReason, deleteBlockTime } from '@/lib/blockTime';
import { decimalToLabel } from '@/lib/timeUtils';

/**
 * Removing blocked time is a real change to the day, so it is always confirmed — and
 * when the block repeats, which occurrences go with it is asked for explicitly.
 */
export default function BlockTimeDeleteDialog({ appt, onClose, onDeleted }) {
  const [scope, setScope] = useState('this');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const repeating = !!appt?.series_id;

  const remove = async () => {
    setBusy(true);
    setError('');
    const res = await deleteBlockTime({ booking_request_id: appt.requestId, scope });
    setBusy(false);
    if (res?.saved !== true) {
      setError(res?.error || 'The block could not be removed. Please try again.');
      return;
    }
    onDeleted?.(res);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-6" onClick={onClose}>
      <div
        className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50">
            <Ban className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-zinc-900">Remove blocked time?</h3>
            <p className="mt-1 text-sm text-zinc-500">
              This time will become available for scheduling again.
            </p>
            <p className="mt-1 text-xs font-medium text-zinc-600">
              {blockReason(appt)} · {appt?.day ? `${appt.day} ` : ''}
              {decimalToLabel(appt?.apptStart)}–{decimalToLabel(appt?.apptEnd)}
            </p>
          </div>
        </div>

        {repeating && <SeriesScopeField value={scope} onChange={setScope} />}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Removing…' : 'Remove Block'}
          </button>
        </div>
      </div>
    </div>
  );
}