/**
 * ExtendedHoursCard — Extended hours settings for a team member.
 * Controls how far the scheduler may stretch outside normal working hours.
 * Extended hours are calculated from normal hours, not a separate schedule.
 */
import React from 'react';
import { Info } from 'lucide-react';
import AdminCard from '@/components/admin/ui/AdminCard';
import { cn } from '@/lib/utils';

const EXTENSION_OPTIONS = [15, 30, 45, 60];
const LATE_EXTENSION_OPTIONS = [15, 30, 45, 60, 90];

function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      className={cn(
        'w-9 h-5 rounded-full transition-colors relative shrink-0',
        disabled && 'opacity-40 cursor-not-allowed',
        value ? 'bg-[#5E42F3]' : 'bg-zinc-300'
      )}
    >
      <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform', value && 'translate-x-4')} />
    </button>
  );
}

export default function ExtendedHoursCard({
  allowEarly,
  earlyMins,
  allowLate,
  lateMins,
  onAllowEarly,
  onEarlyMins,
  onAllowLate,
  onLateMins,
}) {
  const extendedEnabled = allowEarly || allowLate;

  const handleMasterToggle = (on) => {
    onAllowEarly(on);
    onAllowLate(on);
  };

  return (
    <AdminCard className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-100">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Extended hours</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Allow a buffer outside your normal working hours.</p>
        </div>
        <Toggle value={extendedEnabled} onChange={handleMasterToggle} />
      </div>

      {/* Body */}
      <div className={cn('px-4 py-3 space-y-3', !extendedEnabled && 'opacity-50 pointer-events-none')}>
        {/* Early extension */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Toggle value={allowEarly} onChange={onAllowEarly} disabled={!extendedEnabled} />
            <span className="text-sm font-medium text-zinc-700">Allow early extension</span>
          </div>
        </div>
        {allowEarly && extendedEnabled && (
          <div className="flex items-center justify-between pl-11 pb-1">
            <label className="text-xs text-zinc-500">Early extension</label>
            <select
              value={earlyMins}
              onChange={e => onEarlyMins(Number(e.target.value))}
              className="bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] cursor-pointer"
            >
              {EXTENSION_OPTIONS.map(m => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-zinc-100" />

        {/* Late extension */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Toggle value={allowLate} onChange={onAllowLate} disabled={!extendedEnabled} />
            <span className="text-sm font-medium text-zinc-700">Allow late extension</span>
          </div>
        </div>
        {allowLate && extendedEnabled && (
          <div className="flex items-center justify-between pl-11 pb-1">
            <label className="text-xs text-zinc-500">Late extension</label>
            <select
              value={lateMins}
              onChange={e => onLateMins(Number(e.target.value))}
              className="bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] cursor-pointer"
            >
              {LATE_EXTENSION_OPTIONS.map(m => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-zinc-50/50 border-t border-zinc-100">
        <div className="flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-500 leading-relaxed">
            Extended hours expand around normal working hours for scheduling flexibility.
          </p>
        </div>
      </div>
    </AdminCard>
  );
}