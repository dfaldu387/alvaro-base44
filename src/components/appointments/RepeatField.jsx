import React from 'react';
import { cn } from '@/lib/utils';
import { endsLabel, frequencyLabel } from '@/lib/appointmentSeries';

const input = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
const label = 'mb-1 block text-xs font-medium text-zinc-600';

const FREQUENCIES = [1, 2, 3, 4];

/**
 * Repeat — the Square-style repeating option. The scheduling type chosen above is
 * never changed here: every occurrence keeps it.
 */
export default function RepeatField({ repeat, setRepeat, mode, occurrenceCount }) {
  const set = (patch) => setRepeat({ ...repeat, ...patch });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-900">Repeat this appointment</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {mode === 'exact'
              ? 'Each occurrence keeps the same exact time.'
              : 'Each occurrence keeps the same availability window.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={repeat.enabled}
          onClick={() => set({ enabled: !repeat.enabled })}
          className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', repeat.enabled ? 'bg-violet-600' : 'bg-zinc-300')}
        >
          <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', repeat.enabled && 'translate-x-5')} />
        </button>
      </div>

      {repeat.enabled && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Repeat</label>
              <select
                className={cn(input, 'cursor-pointer')}
                value={FREQUENCIES.includes(repeat.everyWeeks) ? String(repeat.everyWeeks) : 'custom'}
                onChange={e => set({ everyWeeks: e.target.value === 'custom' ? 6 : Number(e.target.value) })}
              >
                {FREQUENCIES.map(n => <option key={n} value={n}>{frequencyLabel(n)}</option>)}
                <option value="custom">Custom</option>
              </select>
              {!FREQUENCIES.includes(repeat.everyWeeks) && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={26}
                    value={repeat.everyWeeks}
                    onChange={e => set({ everyWeeks: Math.min(26, Math.max(1, Number(e.target.value) || 1)) })}
                    className={cn(input, 'w-20 tabular-nums')}
                  />
                  <span className="text-xs text-zinc-500">weeks apart</span>
                </div>
              )}
            </div>
            <div>
              <label className={label}>Ends</label>
              <select className={cn(input, 'cursor-pointer')} value={repeat.ends} onChange={e => set({ ends: e.target.value })}>
                <option value="never">Never</option>
                <option value="after">After a number of appointments</option>
                <option value="on">On a specific date</option>
              </select>
              {repeat.ends === 'after' && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={repeat.count}
                    onChange={e => set({ count: Math.min(52, Math.max(1, Number(e.target.value) || 1)) })}
                    className={cn(input, 'w-20 tabular-nums')}
                  />
                  <span className="text-xs text-zinc-500">appointments</span>
                </div>
              )}
              {repeat.ends === 'on' && (
                <input type="date" className={cn(input, 'mt-2')} value={repeat.untilDate} onChange={e => set({ untilDate: e.target.value })} />
              )}
            </div>
          </div>

          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            {occurrenceCount} appointment{occurrenceCount === 1 ? '' : 's'} will be created · {frequencyLabel(repeat.everyWeeks)} · Ends: {endsLabel(repeat)}.
            {repeat.ends === 'never' && ' Upcoming occurrences only — add more later by repeating the booking.'}
          </p>
        </div>
      )}
    </div>
  );
}