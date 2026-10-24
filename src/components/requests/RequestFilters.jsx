import React from 'react';
import { REQUEST_FILTERS } from '@/lib/requestStatus';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PRIORITY_OPTIONS = ['All', 'priority', 'outside_priority'];
const TIER_OPTIONS = ['All', 'priority', 'extended', 'outer'];

const CHIP = 'px-3 min-h-[36px] rounded-full text-xs font-medium whitespace-nowrap transition-all border';
const OFF = 'bg-white border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:border-zinc-300';
const ON = 'bg-zinc-900 border-zinc-900 text-white';
const ON_ATTENTION = 'bg-amber-50 border-amber-300 text-amber-800';

function Chip({ active, attention, onClick, children, className = '' }) {
  return (
    <button onClick={onClick} className={`${CHIP} ${active ? (attention ? ON_ATTENTION : ON) : OFF} ${className}`}>
      {children}
    </button>
  );
}

const Divider = () => <span className="hidden sm:block w-px bg-zinc-200 mx-1" />;

// All the Requests page filters. Chips wrap on small screens, so nothing scrolls sideways.
export default function RequestFilters({ filters, setFilters, zoneOptions, needsActionCount }) {
  const set = (key) => (value) => setFilters(prev => ({ ...prev, [key]: value }));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {['All', ...DAYS].map(day => (
          <Chip key={day} active={filters.day === day} onClick={() => set('day')(day)}>{day}</Chip>
        ))}
      </div>
      {/* Every request is in one state, so a request can always be found: Needs Action
          collects everything Route Flow has not placed. */}
      <div className="flex flex-wrap gap-2">
        {REQUEST_FILTERS.map(f => (
          <Chip key={f.id} active={filters.state === f.id} attention={f.id === 'needs_action'} onClick={() => set('state')(f.id)}>
            {f.label}
            {f.id === 'needs_action' && needsActionCount > 0 && <span className="ml-1.5 text-[10px] font-bold">{needsActionCount}</span>}
          </Chip>
        ))}
        <Divider />
        {PRIORITY_OPTIONS.map(p => (
          <Chip key={p} active={filters.priority === p} onClick={() => set('priority')(p)}>
            {p === 'outside_priority' ? 'Outside' : p === 'priority' ? 'Priority' : 'All Priority'}
          </Chip>
        ))}
        {zoneOptions.length > 1 && (
          <>
            <Divider />
            {zoneOptions.map(z => (
              <Chip key={z} active={filters.zone === z} onClick={() => set('zone')(z)}>{z}</Chip>
            ))}
          </>
        )}
        <Divider />
        {TIER_OPTIONS.map(t => (
          <Chip key={t} active={filters.tier === t} onClick={() => set('tier')(t)} className="capitalize">
            {t === 'All' ? 'All Tiers' : t}
          </Chip>
        ))}
      </div>
    </div>
  );
}