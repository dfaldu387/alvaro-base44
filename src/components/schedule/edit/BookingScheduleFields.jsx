import React from 'react';
import { Calendar, Clock } from 'lucide-react';
import { buildTimeOptions, decimalToLabel } from '@/lib/timeUtils';
import { fieldClass, FieldError } from '@/components/schedule/edit/BookingContactFields';

/**
 * The booking's date and start time.
 *
 * Nothing is decided here: the time the administrator picks is only a proposal,
 * and the scheduling validator on the server checks working hours, overlaps,
 * travel and the booking window when it is saved.
 */
export default function BookingScheduleFields({ date, start, onDate, onStart, durationMins, errors = {} }) {
  const options = buildTimeOptions(5, 23);
  const hasStart = Number.isFinite(Number(start));
  const endLabel = hasStart && durationMins > 0
    ? decimalToLabel(Number(start) + durationMins / 60)
    : null;

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Date &amp; time</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-500">
            <Calendar className="h-3 w-3" /> Date
          </label>
          <input type="date" value={date} onChange={e => onDate(e.target.value)} className={fieldClass} />
          <FieldError>{errors.date}</FieldError>
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-500">
            <Clock className="h-3 w-3" /> Start time
          </label>
          <select
            value={hasStart ? String(start) : ''}
            onChange={e => onStart(parseFloat(e.target.value))}
            className={fieldClass}
          >
            <option value="" disabled>Select time</option>
            {options.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <FieldError>{errors.start}</FieldError>
        </div>
      </div>

      <p className="text-[11px] text-zinc-500">
        {durationMins > 0
          ? `Duration from the services below: ${durationMins} min${endLabel ? ` · ${decimalToLabel(Number(start))}–${endLabel}` : ''}`
          : 'Choose the services below — the duration comes from the catalogue.'}
      </p>
    </div>
  );
}