/**
 * BlockTimeModal — create blocked time on the schedule (Lunch, Personal, Unavailable…).
 * Stored as a real, date-bound schedule record, so removing it later hands the time
 * straight back to scheduling. A repeating block is written as a series, so it can
 * later be edited or removed for one occurrence, all future ones, or the whole series.
 */
import React, { useRef, useState } from 'react';
import { X, Repeat } from 'lucide-react';
import useSubmissionToken from '@/hooks/useSubmissionToken';
import CompactTimePicker from '@/components/ui/CompactTimePicker';
import { getOperatingBounds } from '@/lib/businessHoursUtils';
import { fromDateKey, nextDateForWeekday } from '@/lib/dateScope';
import { decimalToLabel } from '@/lib/timeUtils';
import {
  BLOCK_REASONS, BLOCK_REPEAT_OPTIONS, blockOccurrenceDates, createBlocks,
} from '@/lib/blockTime';
import { cn } from '@/lib/utils';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function BlockTimeModal({ onClose, onSaved, selectedDay, selectedDateKey, businessHours, prefillTime, prefillMinutes }) {
  const submissionToken = useSubmissionToken();
  const [form, setForm] = useState({
    day: selectedDay || DAYS[0],
    // A block created by dragging on the calendar opens at the time that was dragged.
    start: prefillTime != null ? prefillTime : 12,
    end: prefillTime != null ? prefillTime + ((prefillMinutes || 60) / 60) : 13,
    reason: 'Lunch',
    notes: '',
  });
  const [repeatWeeks, setRepeatWeeks] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The operating-hours default applies when the day changes, never over a time the
  // barber already picked.
  const firstRun = useRef(true);

  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const bounds = getOperatingBounds(businessHours, form.day);
    if (bounds) setForm((p) => ({ ...p, start: bounds.start, end: Math.min(bounds.start + 1, bounds.end) }));
  }, [form.day, businessHours]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // A block is a real, date-bound schedule record
  const requestedDate = nextDateForWeekday(selectedDateKey ? fromDateKey(selectedDateKey) : new Date(), form.day) || selectedDateKey || null;
  const dates = requestedDate ? blockOccurrenceDates(requestedDate, repeatWeeks) : [];

  const handleSave = async () => {
    if (form.end <= form.start) { setError('End time must be after start time.'); return; }
    if (!dates.length) { setError('Pick a date for this block.'); return; }
    setSaving(true);
    setError('');
    try {
      const rows = await createBlocks({
        submissionToken,
        reason: form.reason,
        notes: form.notes,
        start: form.start,
        end: form.end,
        dates,
        everyWeeks: repeatWeeks,
      });
      onSaved?.({ count: rows.length, reason: form.reason, repeatWeeks });
    } catch (e) {
      setError(e?.message || 'Failed to save block. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex w-full max-w-md flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3.5">
          <h2 className="text-base font-bold text-zinc-900">Block Time</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-2 block text-xs font-semibold text-zinc-700">Title</label>
            <input
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="Lunch, Personal, Unavailable…"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-400"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {BLOCK_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => set('reason', r)}
                  className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    form.reason === r ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300')}>{r}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700">Start Time</label>
              <CompactTimePicker value={form.start} onChange={(v) => set('start', v)} min={0} max={24} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700">End Time</label>
              <CompactTimePicker value={form.end} onChange={(v) => set('end', v)} min={0} max={24} className="w-full" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-700">Day</label>
            <select value={form.day} onChange={(e) => set('day', e.target.value)} className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400">
              {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {requestedDate && (
              <p className="mt-1 text-[11px] text-zinc-500">
                {decimalToLabel(form.start)}–{decimalToLabel(form.end)} on {requestedDate}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
              <Repeat className="h-3.5 w-3.5 text-indigo-500" /> Repeat
            </label>
            <select value={repeatWeeks} onChange={(e) => setRepeatWeeks(Number(e.target.value))} className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400">
              {BLOCK_REPEAT_OPTIONS.map((o) => <option key={o.weeks} value={o.weeks}>{o.label}</option>)}
            </select>
            {repeatWeeks > 0 && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Creates {dates.length} upcoming blocks — you can later change one, all future ones, or the whole series.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-700">Notes (optional)</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Any extra notes..."
              className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-400" />
          </div>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
        </div>

        <div className="flex shrink-0 gap-3 border-t border-zinc-200 px-5 py-3.5">
          <button onClick={onClose} className="flex-1 rounded-lg border border-zinc-300 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : dates.length > 1 ? `Block ${dates.length} times` : 'Block Time'}
          </button>
        </div>
      </div>
    </div>
  );
}