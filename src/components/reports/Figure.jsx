import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// One report figure. Clicking opens the records behind it. When the figure
// cannot be computed it shows a dash and says exactly why, never a zero.
export default function Figure({ label, value, sub, reason, onClick }) {
  const missing = value == null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white border border-zinc-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all w-full"
    >
      <p className="text-[13px] font-medium text-zinc-600 flex items-center justify-between">
        {label}<ChevronRight className="w-4 h-4 text-zinc-300" />
      </p>
      <p className={cn('text-2xl font-bold mt-1', missing ? 'text-zinc-300' : 'text-zinc-900')}>{missing ? '—' : value}</p>
      {missing && reason
        ? <p className="text-[11px] text-amber-700 mt-1 leading-snug">{reason}</p>
        : sub && <p className="text-[11px] text-zinc-400 mt-1 leading-snug">{sub}</p>}
    </button>
  );
}