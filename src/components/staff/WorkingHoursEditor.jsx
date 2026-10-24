/**
 * WorkingHoursEditor — Mon-Sun rows with checkboxes and compact time pickers.
 * Each row: checkbox, day name, open/close time pickers (or "Closed" text).
 */
import React from 'react';
import CompactTimePicker from '@/components/ui/CompactTimePicker';
import { DAYS_OF_WEEK } from '@/lib/businessHoursUtils';
import { cn } from '@/lib/utils';
import { Copy, Plus } from 'lucide-react';

export default function WorkingHoursEditor({ workingHours, onChange }) {
  const list = Array.isArray(workingHours) ? workingHours : [];
  const hours = DAYS_OF_WEEK.map(d =>
    list.find(h => h.day_of_week === d) || { day_of_week: d, is_open: false, open_time: 9, close_time: 17 }
  );

  const updateDay = (dayName, changes) => {
    const updated = hours.map(h => h.day_of_week === dayName ? { ...h, ...changes } : h);
    onChange(updated);
  };

  const copyToAll = (dayName) => {
    const source = hours.find(h => h.day_of_week === dayName);
    if (!source) return;
    const updated = hours.map(h => ({ ...h, is_open: source.is_open, open_time: source.open_time, close_time: source.close_time }));
    onChange(updated);
  };

  return (
    <div className="space-y-0">
      {hours.map(day => (
        <div key={day.day_of_week} className="flex items-center gap-3 py-2.5 border-b border-zinc-100 last:border-0">
          {/* Checkbox */}
          <button
            type="button"
            onClick={() => updateDay(day.day_of_week, { is_open: !day.is_open })}
            className={cn(
              'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0',
              day.is_open ? 'bg-[#5E42F3] border-[#5E42F3]' : 'bg-white border-zinc-300 hover:border-zinc-400'
            )}
          >
            {day.is_open && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* Day name */}
          <span className={cn('text-sm font-medium w-24 shrink-0', day.is_open ? 'text-zinc-900' : 'text-zinc-400')}>
            {day.day_of_week}
          </span>

          {/* Times */}
          {day.is_open ? (
            <div className="flex items-center gap-2 flex-1">
              <CompactTimePicker
                value={day.open_time}
                onChange={v => updateDay(day.day_of_week, { open_time: v })}
                min={0}
                max={Math.max(day.close_time - 0.25, 0.25)}
              />
              <span className="text-zinc-400 text-xs">to</span>
              <CompactTimePicker
                value={day.close_time}
                onChange={v => updateDay(day.day_of_week, { close_time: v })}
                min={day.open_time + 0.25}
                max={24}
              />
            </div>
          ) : (
            <div className="flex-1">
              <span className="text-sm text-zinc-400 font-medium">Closed</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => copyToAll(day.day_of_week)}
              title="Copy to all days"
              className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Add special hours"
              className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}