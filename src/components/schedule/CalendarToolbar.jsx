import React from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2, Plus, Route as RouteIcon } from 'lucide-react';
import StaffFilter from '@/components/staff/StaffFilter';
import RangeDropdown from '@/components/schedule/RangeDropdown';

/**
 * The Calendar's toolbar: where you are in time, what the grid is showing, and the
 * tools that lay the day out (New) plus the one day-level route action. There is no
 * separate Optimise action: Connect already does that work, and Route Flow places
 * bookings automatically.
 *
 * One Connect Appointments action bunches and saves the current order, whether
 * the route is new or needs updating. Review happens on the calendar; confirming
 * remains the separate, deliberate client-messaging step.
 *
 * Presentational only: every action is a callback the Calendar owns.
 */
export default function CalendarToolbar({
  rangeMode, selectedDate, displayDays,
  onToday, onPrev, onNext,
  staffMembers, selectedStaffId, onSelectStaff, onSelectRange,
  onCreate,
  onConnect, canConnect = false, connecting = false,
  routeStatus = 'draft', confirmed = false,
}) {
  const finalising = connecting || routeStatus === 'finalising';
  // The day is always at one of three stages: choosing the order, connected and
  // waiting to be confirmed, or confirmed.
  const step = confirmed ? 'done'
    : finalising ? 'connect'
      : routeStatus === 'finalised' ? 'confirm'
        : 'reorder';
  const stale = routeStatus === 'needs_update';
  const routeLabel = finalising ? 'Connecting…' : 'Connect Appointments';

  return (
    <div className="bg-white border-b border-zinc-200 px-4 sm:px-6 py-4 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        {/* Left: title + the three stages of the day, so the next move is obvious */}
        <div className="shrink-0">
          <h1 className="text-zinc-900 font-bold text-xl leading-tight">Calendar</h1>
          <div className="mt-1 flex items-center gap-1">
            {[
              { key: 'reorder', label: 'Reorder' },
              { key: 'connect', label: 'Connect' },
              { key: 'confirm', label: 'Confirm' },
            ].map((stage, i) => {
              const active = step === stage.key;
              const done = stage.key !== step
                && (stage.key === 'reorder' || (stage.key === 'connect' && step !== 'reorder'));
              return (
                <span key={stage.key} className="flex items-center gap-1">
                  {i > 0 && <span className={`h-px w-2 ${done || active ? 'bg-[#6366f1]/40' : 'bg-zinc-200'}`} />}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      active ? 'bg-[#6366f1] text-white'
                        : done ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {i + 1} · {stage.label}
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Center: date range navigation */}
        <div className="flex items-center gap-2">
          <button onClick={onToday} className="text-xs font-semibold text-zinc-500 border border-zinc-200 px-3 py-1.5 max-sm:min-h-11 rounded-lg transition-all hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/40 focus-visible:border-[#6366f1]/40">
            Today
          </button>
          <button onClick={onPrev} aria-label="Previous" className="p-1.5 max-sm:min-w-11 max-sm:min-h-11 flex items-center justify-center text-zinc-500 rounded-lg transition-all hover:text-zinc-900 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/40"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-zinc-900 sm:min-w-[180px] text-center">
            {rangeMode === 'day'
              ? format(selectedDate, 'MMM d, yyyy')
              : `${format(displayDays[0], 'MMM d')} – ${format(displayDays[displayDays.length - 1], 'MMM d, yyyy')}`}
          </span>
          <button onClick={onNext} aria-label="Next" className="p-1.5 max-sm:min-w-11 max-sm:min-h-11 flex items-center justify-center text-zinc-500 rounded-lg transition-all hover:text-zinc-900 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/40"><ChevronRight className="w-4 h-4" /></button>
        </div>

        {/* Right: controls */}
        <div className="flex flex-wrap items-center gap-2">
          <StaffFilter members={staffMembers} selectedId={selectedStaffId} onChange={onSelectStaff} />
          <RangeDropdown value={rangeMode} onChange={onSelectRange} />
          <button onClick={onCreate} className="flex items-center gap-1.5 border border-[#6366f1]/40 bg-white hover:bg-[#6366f1]/5 text-[#5b4ae0] text-xs font-bold px-3.5 py-2 max-sm:min-h-11 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/40">
            <Plus className="w-3.5 h-3.5" /> New
          </button>

          {/* The same action connects or refreshes the current arrangement. */}
          {
            <button
              onClick={onConnect}
              disabled={!canConnect || finalising}
              title={stale
                ? 'Connect again to bunch the current order and refresh driving times; no separate rebuild is needed'
                : canConnect ? 'Bunch this day in your order, save the times and refresh the calendar. No client messages are sent.' : 'A route needs at least two appointments'}
              className="flex items-center gap-1.5 bg-[#6366f1] hover:bg-[#5851e0] text-white text-xs font-bold px-3.5 py-2 max-sm:min-h-11 rounded-lg transition-all shadow-sm disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#6366f1]"
            >
              {finalising
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RouteIcon className="w-3.5 h-3.5" />}
              {routeLabel}
            </button>
          }
        </div>
      </div>
    </div>
  );
}