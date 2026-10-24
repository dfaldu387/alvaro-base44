/**
 * CompactTimePicker — Square-style scrollable time dropdown.
 * 15-minute increments, fixed max height with internal scroll, highlights selected.
 *
 * Props:
 *   value: decimal hour (e.g. 14.5)
 *   onChange: (decimalHour) => void
 *   min: decimal hour lower bound (default 0)
 *   max: decimal hour upper bound (default 24)
 *   className?: string
 *   disabled?: boolean
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { decimalToLabel } from '@/lib/timeUtils';
import { cn } from '@/lib/utils';

export default function CompactTimePicker({ value, onChange, min = 0, max = 24, className, disabled = false }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);

  const options = useMemo(() => {
    const opts = [];
    const snap = 0.25;
    let dec = Math.ceil(min / snap) * snap;
    // Fix floating point: 9.00000001 → 9
    dec = Math.round(dec * 100) / 100;
    while (dec <= max + 0.001) {
      opts.push({ value: dec, label: decimalToLabel(dec) });
      dec = Math.round((dec + snap) * 100) / 100;
    }
    return opts;
  }, [min, max]);

  useEffect(() => {
    if (open && listRef.current && value != null) {
      const el = listRef.current.querySelector('[data-selected="true"]');
      if (el) el.scrollIntoView({ block: 'center' });
    }
  }, [open, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex items-center justify-between gap-1 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 hover:border-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            className
          )}
        >
          <span>{value != null ? decimalToLabel(value) : 'Select'}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-32 p-0 bg-white border border-zinc-200 shadow-lg rounded-lg"
      >
        <div ref={listRef} className="max-h-52 overflow-y-auto py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              data-selected={value === opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'w-full px-3 py-1.5 text-left text-sm transition-colors',
                value === opt.value
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-zinc-700 hover:bg-zinc-50'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}