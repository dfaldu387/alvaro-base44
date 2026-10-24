import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import AdminCard from '@/components/admin/ui/AdminCard';

// Collapsible titled card used by the Booking Rules page.
export function Accordion({ title, open, onToggle, children }) {
  return (
    <AdminCard className="p-0 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3.5 min-h-[48px] hover:bg-zinc-50 transition-colors">
        <span className="text-sm font-semibold text-zinc-900">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-4 border-t border-zinc-200 pt-4">{children}</div>}
    </AdminCard>
  );
}

// Shown beside a setting that is saved but that nothing in the booking system reads yet.
export function NotInEffect() {
  return <span className="inline-block align-middle ml-1.5 text-[11px] font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">Not in effect yet</span>;
}

// A plain-words notice at the top of a group of settings that are not in effect yet.
export function NotInEffectNote({ children }) {
  return (
    <div role="note" className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
      <p className="font-semibold">Not in effect yet</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

export function Toggle({ label, sub, value, onChange, inactive = false }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-zinc-900">{label}{inactive && <NotInEffect />}</p>
        {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn("w-11 h-6 rounded-full transition-colors shrink-0 relative before:content-[''] before:absolute before:inset-x-0 before:-inset-y-2.5", value ? 'bg-indigo-600' : 'bg-zinc-300')}
      >
        <span className={cn('absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform', value ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, error, inactive = false }) {
  // The raw typed text is kept, so an invalid entry is reported — never silently replaced.
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-zinc-900 flex-1">{label}{inactive && <NotInEffect />}</label>
        <Input
          type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(e.target.value)}
          className={cn('w-20 h-11 sm:h-10 text-center px-2', error && 'border-red-500')}
        />
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function InfoField({ label, value }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <p className="text-sm text-zinc-900">{label}</p>
      <p className="text-sm text-zinc-500">{value}</p>
    </div>
  );
}