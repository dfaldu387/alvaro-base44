import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import CompactTimePicker from '@/components/ui/CompactTimePicker';
import { rangeLabel, serviceDuration } from '@/lib/appointmentForm';

const input = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
const label = 'mb-1 block text-xs font-medium text-zinc-600';

const WINDOW_CHOICES = [
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
];

/**
 * Date & time — one choice, made once: the agreed exact time, or an availability
 * window Route Flow may place inside. The two are never mixed into one vague toggle.
 */
export default function ScheduleField({
  mode, setMode, date, setDate, startTime, setStartTime,
  windowStart, setWindowStart, windowMinutes, setWindowMinutes,
  staffId, setStaffId, staffMembers, serviceMins, windowEnd, draggedMins = null,
}) {
  const tooShort = windowMinutes < serviceMins;

  return (
    <div className="space-y-4">
      {/* Scheduling type */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1">
        {[
          { key: 'exact', label: 'Exact time' },
          { key: 'window', label: 'Availability window' },
        ].map(option => (
          <button
            key={option.key}
            type="button"
            onClick={() => setMode(option.key)}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              mode === option.key ? 'bg-white text-violet-700 shadow-sm' : 'text-zinc-600 hover:text-zinc-900',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Date</label>
          <input type="date" className={input} value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className={label}>Barber</label>
          <select className={cn(input, 'cursor-pointer')} value={staffId || ''} onChange={e => setStaffId(e.target.value || null)}>
            {(staffMembers || []).filter(m => m.status === 'Active' && m.is_bookable).map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {mode === 'exact' ? (
        <div>
          <label className={label}>Start time</label>
          <div className="flex items-center gap-3">
            <CompactTimePicker value={startTime} onChange={setStartTime} min={0} max={24} />
            <span className="text-xs text-zinc-500">
              {serviceMins > 0 && `Ends ${rangeLabel(startTime, startTime + serviceMins / 60)}`}
              {/* A dragged range only opens the form at this time: the service sets the real length. */}
              {serviceMins === 0 && draggedMins && `Dragged ${rangeLabel(startTime, startTime + draggedMins / 60)} — the service sets the real duration`}
              {serviceMins === 0 && !draggedMins && 'Add a service to set the end time'}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Available from</label>
              <CompactTimePicker value={windowStart} onChange={setWindowStart} min={0} max={24} />
            </div>
            <div>
              <label className={label}>Available for</label>
              <select
                className={cn(input, 'cursor-pointer')}
                value={WINDOW_CHOICES.some(c => c.minutes === windowMinutes) ? String(windowMinutes) : 'custom'}
                onChange={e => setWindowMinutes(e.target.value === 'custom' ? 90 : Number(e.target.value))}
              >
                {WINDOW_CHOICES.map(c => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                <option value="custom">Custom</option>
              </select>
              {!WINDOW_CHOICES.some(c => c.minutes === windowMinutes) && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={windowMinutes}
                    onChange={e => setWindowMinutes(Math.max(15, Number(e.target.value) || 15))}
                    className={cn(input, 'w-24 tabular-nums')}
                  />
                  <span className="text-xs text-zinc-500">minutes</span>
                </div>
              )}
            </div>
          </div>

          {/* The calculated window, stated plainly */}
          <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
            <p className="text-sm font-semibold text-violet-800">Availability: {rangeLabel(windowStart, windowEnd)}</p>
            <p className="mt-0.5 text-xs text-violet-700/80">
              Route Flow places the appointment anywhere inside this window.
            </p>
          </div>

          {tooShort && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-800">
                This service needs {serviceDuration(serviceMins)} — the window must be at least that long.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}