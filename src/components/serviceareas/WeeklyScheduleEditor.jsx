import React from 'react';
import { WEEK_DAYS, DAY_SHORT, decimalToTimeInput, timeInputToDecimal } from '@/lib/serviceAreaUtils';
import Switch from './Switch';

// Dark-themed weekly schedule editor.
export default function WeeklyScheduleEditor({ days, onChange }) {
  const update = (dayName, patch) => {
    onChange(days.map((d) => (d.day_of_week === dayName ? { ...d, ...patch } : d)));
  };

  return (
    <div className="divide-y divide-[#222226] rounded-xl border border-[#27272a] overflow-hidden">
      {WEEK_DAYS.map((day) => {
        const d = days.find((x) => x.day_of_week === day) || { day_of_week: day, enabled: false, open_time: 9, close_time: 17, max_bookings: 8 };
        const enabled = !!d.enabled;
        return (
          <div key={day} className="px-3.5 py-3 bg-[#1a1a1e]">
            <div className="flex items-center gap-3 min-h-[28px]">
              <Switch checked={enabled} onChange={() => update(day, { enabled: !enabled })} label={day} />
              <span className={`w-14 text-sm font-medium shrink-0 ${enabled ? 'text-white' : 'text-zinc-600'}`}>{DAY_SHORT[day]}</span>
              {enabled ? (
                <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                  <input
                    type="time"
                    value={decimalToTimeInput(d.open_time)}
                    onChange={(e) => update(day, { open_time: timeInputToDecimal(e.target.value) })}
                    className="bg-[#222226] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-[#6366f1]"
                  />
                  <span className="text-zinc-600 text-xs">→</span>
                  <input
                    type="time"
                    value={decimalToTimeInput(d.close_time)}
                    onChange={(e) => update(day, { close_time: timeInputToDecimal(e.target.value) })}
                    className="bg-[#222226] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-[#6366f1]"
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-500">Max</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={d.max_bookings ?? 8}
                      onChange={(e) => update(day, { max_bookings: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-14 bg-[#222226] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-white text-center outline-none focus:border-[#6366f1]"
                    />
                  </div>
                </div>
              ) : (
                <span className="text-xs text-zinc-600 ml-auto">Closed</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}