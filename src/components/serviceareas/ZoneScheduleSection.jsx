import React from 'react';
import SectionCard from './SectionCard';
import WeeklyScheduleEditor from './WeeklyScheduleEditor';

// Dark-themed schedule & capacity section.
export default function ZoneScheduleSection({ draft, set, canEdit }) {
  return (
    <SectionCard title="Schedule & capacity" description="Set which days you work here, your hours, and booking limits.">
      <WeeklyScheduleEditor
        days={draft.service_days || []}
        onChange={(d) => canEdit && set('service_days', d)}
      />
      <div className="rounded-xl border border-[#27272a] bg-[#222226] px-4 py-3.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">Default max bookings per day</p>
          <p className="text-xs text-zinc-500 mt-0.5">Used when a service day has no custom maximum.</p>
        </div>
        <input
          type="number"
          min={1}
          max={60}
          value={draft.max_bookings_per_day ?? 8}
          onChange={(e) => set('max_bookings_per_day', Math.max(1, Number(e.target.value) || 1))}
          disabled={!canEdit}
          className="w-20 shrink-0 bg-[#1a1a1e] border border-[#27272a] rounded-lg px-2.5 py-2 text-sm text-white text-center outline-none focus:border-[#6366f1] disabled:opacity-50"
        />
      </div>
    </SectionCard>
  );
}