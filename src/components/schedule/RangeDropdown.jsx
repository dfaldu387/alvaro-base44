/**
 * RangeDropdown — compact Square-style range selector (Day / 4 Days / Week).
 */
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: '4days', label: '4 Days' },
  { value: 'week', label: 'Week' },
];

export default function RangeDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = OPTIONS.find(o => o.value === value) || OPTIONS[2];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 border border-zinc-200 px-3 py-2 max-sm:min-h-11 rounded-lg hover:bg-zinc-50 transition-all bg-white"
      >
        Range: {current.label}
        <ChevronDown className={cn('w-3.5 h-3.5 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 z-50">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn('w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors',
                value === opt.value ? 'text-indigo-600 bg-[#4f46e5]/10' : 'text-zinc-500 hover:bg-zinc-50')}
            >
              {opt.label}
              {value === opt.value && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}