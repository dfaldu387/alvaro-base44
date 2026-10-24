import React, { useState } from 'react';
import { X } from 'lucide-react';
import CompactTimePicker from '@/components/ui/CompactTimePicker';
import SeriesScopeField from '@/components/schedule/SeriesScopeField';
import { BLOCK_REASONS, updateBlockTime } from '@/lib/blockTime';
import { decimalToLabel } from '@/lib/timeUtils';
import { cn } from '@/lib/utils';

/**
 * Edit a blocked time: what it is, which date, when it runs, and — for a repeating
 * block — which occurrences the change applies to. The server owns the rules (it
 * refuses a time that would double-book), so a refusal is shown here in plain English
 * instead of the change quietly not happening.
 */
export default function BlockTimeEditDialog({ appt, onClose, onSaved }) {
  const [reason, setReason] = useState(appt?.services?.[0] || 'Lunch');
  const [date, setDate] = useState(appt?.date || '');
  const [start, setStart] = useState(appt?.apptStart ?? 12);
  const [end, setEnd] = useState(appt?.apptEnd ?? 13);
  const [notes, setNotes] = useState(appt?.notes || '');
  const [scope, setScope] = useState('this');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const repeating = !!appt?.series_id;

  const save = async () => {
    if (end <= start) { setError('The end time must be after the start time.'); return; }
    setSaving(true);
    setError('');
    const res = await updateBlockTime({
      booking_request_id: appt.requestId,
      reason: reason.trim() || 'Blocked time',
      requested_date: date || undefined,
      start,
      end,
      notes,
      scope,
    });
    setSaving(false);
    if (res?.saved !== true) {
      setError(res?.error || 'The block could not be saved. Please try again.');
      return;
    }
    onSaved?.(res);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-md flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3.5">
          <h2 className="text-base font-bold text-zinc-900">Edit blocked time</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-2 block text-xs font-semibold text-zinc-700">Title</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lunch, Personal, Unavailable…"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-400"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {BLOCK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    reason === r
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-700">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400"
            />
            {repeating && scope !== 'this' && (
              <p className="mt-1 text-[11px] text-zinc-500">Each occurrence stays on its own date.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700">Start time</label>
              <CompactTimePicker value={start} onChange={setStart} min={0} max={24} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700">End time</label>
              <CompactTimePicker value={end} onChange={setEnd} min={0} max={24} className="w-full" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-700">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any extra notes…"
              className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-400"
            />
          </div>

          {repeating && <SeriesScopeField value={scope} onChange={setScope} />}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>
          )}
        </div>

        <div className="flex shrink-0 gap-3 border-t border-zinc-200 px-5 py-3.5">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-300 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Save ${decimalToLabel(start)}–${decimalToLabel(end)}`}
          </button>
        </div>
      </div>
    </div>
  );
}