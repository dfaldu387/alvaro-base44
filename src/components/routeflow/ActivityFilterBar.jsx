import React from 'react';
import { addDays, format, isToday, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CATEGORIES } from '@/lib/routeFlowActivity';
import { cn } from '@/lib/utils';

/**
 * Which activity, and which day. Filters are applied on the server, so a change
 * here is a new read rather than a narrowing of what is already on screen.
 */
export default function ActivityFilterBar({ category, onCategory, date, onDate, count, loading }) {
  const reference = date || new Date();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => onCategory(c.value)}
            className={cn(
              'text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors',
              category === c.value
                ? 'bg-[#6366F1] border-[#6366F1] text-white'
                : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onDate(null)}
          className={cn(
            'text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors',
            date === null ? 'border-zinc-300 bg-zinc-100 text-zinc-700' : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300'
          )}
        >
          All dates
        </button>
        <button
          onClick={() => onDate(new Date())}
          className={cn(
            'text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors',
            date && isToday(date) ? 'border-zinc-300 bg-zinc-100 text-zinc-700' : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300'
          )}
        >
          Today
        </button>
        <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-lg px-1 py-0.5">
          <button
            onClick={() => onDate(subDays(reference, 1))}
            className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-800"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold text-zinc-700 min-w-[78px] text-center">
            {date ? format(reference, 'EEE d MMM') : 'Any day'}
          </span>
          <button
            onClick={() => onDate(addDays(reference, 1))}
            className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-800"
            aria-label="Next day"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <span className="text-xs text-zinc-400">
          {loading ? 'Loading…' : `${count} entr${count === 1 ? 'y' : 'ies'}`}
        </span>
      </div>
    </div>
  );
}