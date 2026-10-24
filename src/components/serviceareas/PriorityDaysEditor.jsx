import React from 'react';
import { WEEK_DAYS, DAY_SHORT } from '@/lib/serviceAreaUtils';
import Switch from './Switch';

// Simple ON/OFF day toggles for Service Zone priority days.
// No time pickers, no max bookings — those belong to Bookable Hours / Booking Rules.
export default function PriorityDaysEditor({ days, onChange }) {
  const update = (dayName, patch) => {
    onChange(days.map((d) => (d.day_of_week === dayName ? { ...d, ...patch } : d)));
  };

  return (
    <div className="divide-y divide-[#222226] rounded-xl border border-[#27272a] overflow-hidden">
      {WEEK_DAYS.map((day) => {
        const d = days.find((x) => x.day_of_week === day) || { day_of_week: day, enabled: false };
        const enabled = !!d.enabled;
        return (
          <div key={day} className="px-3.5 py-3 bg-[#1a1a1e] flex items-center gap-3">
            <Switch checked={enabled} onChange={() => update(day, { enabled: !enabled })} label={day} />
            <span className={`w-14 text-sm font-medium shrink-0 ${enabled ? 'text-white' : 'text-zinc-600'}`}>{DAY_SHORT[day]}</span>
            <span className={`text-xs ml-auto ${enabled ? 'text-[#818cf8] font-medium' : 'text-zinc-600'}`}>
              {enabled ? 'Priority day' : 'Off'}
            </span>
          </div>
        );
      })}
    </div>
  );
}