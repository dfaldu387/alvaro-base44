import React, { useState } from 'react';
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Sort modes for the Clients table. created_date is the client's real
// creation timestamp — never the last visit or updated_date.
export const SORT_MODES = [
  { key: 'latest', label: 'Latest added', sort: { key: 'created', dir: 'desc' } },
  { key: 'oldest', label: 'Oldest added', sort: { key: 'created', dir: 'asc' } },
  { key: 'name_asc', label: 'Name A–Z', sort: { key: 'client', dir: 'asc' } },
  { key: 'name_desc', label: 'Name Z–A', sort: { key: 'client', dir: 'desc' } },
];

export const sortToMode = (sort) =>
  SORT_MODES.find(m => m.sort.key === sort?.key && m.sort.dir === sort?.dir)?.key || null;

export default function SortDropdown({ sort, onChange }) {
  const [open, setOpen] = useState(false);
  const mode = sortToMode(sort);
  const active = SORT_MODES.find(m => m.key === mode) || null;

  const select = (m) => { onChange(m.sort); setOpen(false); };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        title="Sort clients"
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border bg-white text-sm',
          active ? 'border-zinc-300 text-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'
        )}
      >
        <ArrowUpDown className="w-4 h-4" />
        {active ? `Sort: ${active.label}` : 'Sort'}
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 z-40 w-48 bg-white border border-zinc-200 rounded-lg shadow-xl py-1">
            {SORT_MODES.map(m => (
              <button
                key={m.key}
                onClick={() => select(m)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                <Check className={cn('w-3.5 h-3.5', mode === m.key ? 'text-indigo-600' : 'text-transparent')} />
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}