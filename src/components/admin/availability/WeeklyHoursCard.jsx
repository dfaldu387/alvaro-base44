import React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import AdminSection from '@/components/admin/ui/AdminSection';
import { decimalToTimeInput, timeInputToDecimal } from '@/lib/serviceAreaUtils';

// Seven day rows: switch, day name, open/close times. Times wrap under the name on narrow screens.
export default function WeeklyHoursCard({ hours, onChange }) {
  return (
    <AdminSection title="Weekly Working Hours" description="Set the days and times you accept bookings.">
      <div className="-mx-4 -mb-4 divide-y divide-zinc-200 border-t border-zinc-200">
        {hours.map((h) => {
          const open = !!h.is_open;
          return (
            <div key={h.day_of_week} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                role="switch"
                aria-checked={open}
                aria-label={`${h.day_of_week} open`}
                onClick={() => onChange(h.day_of_week, { is_open: !open })}
                className={cn("w-11 h-6 rounded-full transition-colors shrink-0 relative before:content-[''] before:absolute before:inset-x-0 before:-inset-y-2.5", open ? 'bg-indigo-600' : 'bg-zinc-300')}
              >
                <span className={cn('absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform', open ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
              <span className={cn('w-24 text-sm font-medium', open ? 'text-zinc-900' : 'text-zinc-500')}>{h.day_of_week}</span>
              {open ? (
                <div className="flex items-center gap-2 sm:ml-auto w-full sm:w-auto">
                  <Input
                    type="time"
                    value={decimalToTimeInput(h.open_time)}
                    onChange={(e) => onChange(h.day_of_week, { open_time: timeInputToDecimal(e.target.value) })}
                    className="h-11 sm:h-10 bg-white sm:w-32"
                  />
                  <span className="text-zinc-400 text-sm">→</span>
                  <Input
                    type="time"
                    value={decimalToTimeInput(h.close_time)}
                    onChange={(e) => onChange(h.day_of_week, { close_time: timeInputToDecimal(e.target.value) })}
                    className="h-11 sm:h-10 bg-white sm:w-32"
                  />
                </div>
              ) : (
                <span className="text-xs text-zinc-500 ml-auto">Closed</span>
              )}
            </div>
          );
        })}
      </div>
    </AdminSection>
  );
}