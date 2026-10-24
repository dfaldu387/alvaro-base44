import React, { useMemo, useState } from 'react';
import { Minus, Plus, Scissors } from 'lucide-react';
import { money, serviceDuration } from '@/lib/appointmentForm';
import { activeServices, quantityGroups, serviceByName } from '@/lib/bookingPeople';

/**
 * Services by quantity — the fast way to say "two Haircuts and three Kids Cuts".
 *
 * Every unit is one person, so a service is never disabled after being chosen once
 * and nothing here has to be un-picked before it can be added again.
 */
export default function ServicesField({ services, people, onAddUnit, onRemoveUnit }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const catalogue = useMemo(() => activeServices(services), [services]);
  const groups = useMemo(() => quantityGroups(people), [people]);
  const counts = useMemo(() => {
    const map = {};
    groups.forEach(g => { map[g.name] = g.count; });
    return map;
  }, [groups]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogue.filter(s => !q || s.name?.toLowerCase().includes(q));
  }, [catalogue, query]);

  return (
    <div className="space-y-2">
      {groups.map(group => {
        const svc = serviceByName(catalogue, group.name);
        const unitPrice = Number(svc?.price) || 0;
        const unitMins = Number(svc?.duration_mins) || 0;
        return (
          <div key={group.name} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50">
              <Scissors className="h-4 w-4 text-violet-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-900">{group.name}</p>
              <p className="text-xs text-zinc-500">{money(unitPrice)} · {serviceDuration(unitMins)} each</p>
            </div>

            {/* − 2 + — one unit is one person */}
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 p-0.5">
              <button
                type="button"
                onClick={() => onRemoveUnit(group.name)}
                aria-label={`One fewer ${group.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-5 text-center text-sm font-semibold tabular-nums text-zinc-900">{group.count}</span>
              <button
                type="button"
                onClick={() => onAddUnit(group.name)}
                aria-label={`One more ${group.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-900">
              {money(unitPrice * group.count)}
            </span>
          </div>
        );
      })}

      {adding ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search services"
            className="w-full border-b border-zinc-100 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400"
          />
          <div className="max-h-56 overflow-y-auto">
            {results.map(svc => (
              <button
                key={svc.id}
                type="button"
                onClick={() => onAddUnit(svc.name)}
                className="flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-2.5 text-left last:border-0 hover:bg-violet-50/60"
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-violet-600" />
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-900">{svc.name}</span>
                {counts[svc.name] > 0 && (
                  <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                    {counts[svc.name]}
                  </span>
                )}
                <span className="shrink-0 text-xs text-zinc-500">{serviceDuration(svc.duration_mins)}</span>
                <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-zinc-900">{money(svc.price)}</span>
              </button>
            ))}
            {results.length === 0 && <p className="px-3 py-3 text-xs text-zinc-500">No service matches that search.</p>}
          </div>
          <button
            type="button"
            onClick={() => { setAdding(false); setQuery(''); }}
            className="w-full border-t border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-500 hover:bg-zinc-50"
          >
            Done
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-violet-300 hover:bg-violet-50/50 hover:text-violet-700"
        >
          <Plus className="h-4 w-4" />
          Add service
        </button>
      )}
    </div>
  );
}