import React, { useEffect, useRef, useState } from 'react';
import { Settings2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ALL_COLUMNS = [
  { key: 'client', label: 'Client', locked: true },
  { key: 'contact', label: 'Contact' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'availability_type', label: 'Availability Type' },
  { key: 'status', label: 'Status' },
  { key: 'last_visit', label: 'Last Visit' },
  { key: 'visits', label: 'Visits' },
  { key: 'first_visit', label: 'First Visit' },
  { key: 'created', label: 'Created' },
  { key: 'avg_spend', label: 'Average Spend' },
  { key: 'lifetime_spend', label: 'Lifetime Spend' },
  { key: 'tags', label: 'Tags' },
];

export const DEFAULT_COLS = ['client', 'contact', 'frequency', 'availability_type', 'status', 'last_visit', 'visits'];

export default function ColumnSelector({ visible, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  const toggle = (key) => {
    if (visible.includes(key)) onChange(visible.filter(k => k !== key));
    else onChange([...visible, key]);
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50">
        <Settings2 className="w-4 h-4" /> Columns
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-40 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl py-1 max-h-[60vh] overflow-y-auto">
          <p className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Toggle columns</p>
          {ALL_COLUMNS.map(col => {
            const on = visible.includes(col.key);
            return (
              <button key={col.key} disabled={col.locked} onClick={() => toggle(col.key)}
                className={cn('w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-zinc-50', col.locked && 'opacity-50 cursor-not-allowed')}>
                <span className="text-zinc-700">{col.label}</span>
                {on && <Check className="w-3.5 h-3.5 text-indigo-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}