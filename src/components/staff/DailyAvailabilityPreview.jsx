/**
 * DailyAvailabilityPreview — Horizontal timeline showing how normal,
 * extended, and after-hours work together for a typical day.
 *
 * Segments: After Hours → Extended (early) → Normal → Extended (late) → After Hours
 */
import React, { useState, useMemo } from 'react';
import AdminCard from '@/components/admin/ui/AdminCard';
import { ChevronDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function fmtTime(dec) {
  if (dec == null) return '';
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  const period = h >= 12 ? 'pm' : 'am';
  const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${dh}:${String(m).padStart(2, '0')}${period}`;
}

export default function DailyAvailabilityPreview({
  workingHours = [],
  allowEarlyExtension = false,
  earlyExtensionMinutes = 30,
  allowLateExtension = false,
  lateExtensionMinutes = 60,
}) {
  const [selectedDay, setSelectedDay] = useState('Thursday');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dayData = useMemo(() => {
    const hours = Array.isArray(workingHours) ? workingHours : [];
    const day = hours.find(h => h.day_of_week === selectedDay) || { day_of_week: selectedDay, is_open: false, open_time: 9, close_time: 17 };

    if (!day.is_open) {
      return { closed: true, normalStart: null, normalEnd: null, extendedStart: null, extendedEnd: null };
    }

    const normalStart = day.open_time ?? 9;
    const normalEnd = day.close_time ?? 17;

    const earlyHrs = allowEarlyExtension ? earlyExtensionMinutes / 60 : 0;
    const lateHrs = allowLateExtension ? lateExtensionMinutes / 60 : 0;

    const extendedStart = normalStart - earlyHrs;
    const extendedEnd = normalEnd + lateHrs;

    return { closed: false, normalStart, normalEnd, extendedStart, extendedEnd };
  }, [workingHours, selectedDay, allowEarlyExtension, earlyExtensionMinutes, allowLateExtension, lateExtensionMinutes]);

  // Preview window: 6am to 10pm, or adjusted to fit the day's hours
  const previewStart = dayData.closed ? 6 : Math.min(6, dayData.extendedStart - 0.5);
  const previewEnd = dayData.closed ? 22 : Math.max(22, dayData.extendedEnd + 0.5);
  const totalMins = (previewEnd - previewStart) * 60;

  const segments = useMemo(() => {
    if (dayData.closed) {
      return [{ type: 'after', start: previewStart, end: previewEnd, label: 'Closed' }];
    }

    const segs = [];
    // After hours (before extended)
    if (dayData.extendedStart > previewStart) {
      segs.push({ type: 'after', start: previewStart, end: dayData.extendedStart, label: 'After Hours' });
    }
    // Extended (early)
    if (dayData.extendedStart < dayData.normalStart) {
      segs.push({ type: 'extended', start: dayData.extendedStart, end: dayData.normalStart, label: 'Extended' });
    }
    // Normal
    segs.push({ type: 'normal', start: dayData.normalStart, end: dayData.normalEnd, label: 'Normal Hours' });
    // Extended (late)
    if (dayData.extendedEnd > dayData.normalEnd) {
      segs.push({ type: 'extended', start: dayData.normalEnd, end: dayData.extendedEnd, label: 'Extended' });
    }
    // After hours (after extended)
    if (previewEnd > dayData.extendedEnd) {
      segs.push({ type: 'after', start: dayData.extendedEnd, end: previewEnd, label: 'After Hours' });
    }
    return segs;
  }, [dayData, previewStart, previewEnd]);

  const segColors = {
    normal: { bg: 'bg-[#4F46E5]', text: 'text-white', label: 'Normal Hours' },
    extended: { bg: 'bg-[#818CF8]', text: 'text-white', label: 'Extended Hours' },
    after: { bg: 'bg-zinc-200', text: 'text-zinc-500', label: 'After Hours' },
  };

  return (
    <AdminCard className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-100">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Daily Availability Preview</h3>
          <p className="text-xs text-zinc-500 mt-0.5">See how normal, extended and after-hours work together for a typical day.</p>
        </div>
        {/* Day selector */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className="flex items-center gap-1.5 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            {selectedDay}
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          </button>
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 min-w-[120px]">
                {DAYS.map(d => (
                  <button
                    key={d}
                    onClick={() => { setSelectedDay(d); setDropdownOpen(false); }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-50 transition-colors',
                      d === selectedDay ? 'text-[#5E42F3] font-semibold' : 'text-zinc-700'
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 py-5">
        {dayData.closed ? (
          <div className="flex items-center justify-center h-16 rounded-lg bg-zinc-50 border border-dashed border-zinc-200">
            <span className="text-sm font-medium text-zinc-400">Closed on {selectedDay}</span>
          </div>
        ) : (
          <>
            {/* Time labels above bar */}
            <div className="relative h-5 mb-1">
              {segments.map((seg, i) => {
                const widthPct = ((seg.end - seg.start) / (previewEnd - previewStart)) * 100;
                const leftPct = ((seg.start - previewStart) / (previewEnd - previewStart)) * 100;
                const showLabel = (seg.end - seg.start) >= 0.75; // show if segment is >= 45 mins
                return (
                  <div
                    key={i}
                    className="absolute text-[10px] font-medium text-zinc-400"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      textAlign: 'center',
                    }}
                  >
                    {showLabel && fmtTime(seg.start)}
                  </div>
                );
              })}
            </div>

            {/* Timeline bar */}
            <div className="flex h-10 rounded-lg overflow-hidden">
              {segments.map((seg, i) => {
                const widthPct = ((seg.end - seg.start) / (previewEnd - previewStart)) * 100;
                const color = segColors[seg.type];
                const isAfter = seg.type === 'after';
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center justify-center text-[10px] font-semibold',
                      color.bg,
                      color.text,
                      isAfter && 'border-l border-zinc-300/50',
                      i > 0 && 'border-l border-white/20'
                    )}
                    style={{ width: `${widthPct}%` }}
                    title={`${seg.label}: ${fmtTime(seg.start)} – ${fmtTime(seg.end)}`}
                  >
                    {(seg.end - seg.start) >= 1 && (
                      <span className="px-1 truncate">{seg.label}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Time labels below bar */}
            <div className="relative h-5 mt-1">
              {segments.map((seg, i) => {
                const widthPct = ((seg.end - seg.start) / (previewEnd - previewStart)) * 100;
                const leftPct = ((seg.start - previewStart) / (previewEnd - previewStart)) * 100;
                const showLabel = (seg.end - seg.start) >= 0.75;
                return (
                  <div
                    key={i}
                    className="absolute text-[10px] font-medium text-zinc-400"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      textAlign: 'center',
                    }}
                  >
                    {showLabel && fmtTime(seg.end)}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-3.5 border-t border-zinc-100 bg-zinc-50/30">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#4F46E5]" />
            <div>
              <p className="text-xs font-semibold text-zinc-700">Normal Hours</p>
              <p className="text-[10px] text-zinc-400">Regular working hours</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#818CF8]" />
            <div>
              <p className="text-xs font-semibold text-zinc-700">Extended Hours</p>
              <p className="text-[10px] text-zinc-400">Buffer before and after normal hours</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-zinc-200 border border-zinc-300" />
            <div>
              <p className="text-xs font-semibold text-zinc-700">After Hours</p>
              <p className="text-[10px] text-zinc-400">Outside extended hours / manual approval</p>
            </div>
          </div>
        </div>
      </div>
    </AdminCard>
  );
}