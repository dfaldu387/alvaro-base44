import React from 'react';
import { CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "This block only / This and future blocks / Entire series" — asked whenever a
 * repeating block (or appointment) is about to be changed or removed, so one tap can
 * never quietly take out every future occurrence.
 */
const OPTIONS = [
  { value: 'this', label: 'This block only' },
  { value: 'future', label: 'This and future blocks' },
  { value: 'series', label: 'Entire series' },
];

export default function SeriesScopeField({ value, onChange, label = null, className }) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <CalendarRange className="h-3.5 w-3.5 text-indigo-500" />
        <span className="text-xs font-semibold text-zinc-700">{label || 'This block repeats'}</span>
      </div>
      <div className="space-y-1.5">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors',
              value === option.value
                ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
            )}
          >
            <span className={cn(
              'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
              value === option.value ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-300',
            )}>
              {value === option.value && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}