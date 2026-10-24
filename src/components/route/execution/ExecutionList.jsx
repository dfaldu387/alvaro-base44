import React from 'react';
import { Car, Clock, ListOrdered, Scissors } from 'lucide-react';
import ExecutionRow from './ExecutionRow';

function fmtMins(mins) {
  if (!mins || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function Stat({ icon, value, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">{icon}</div>
      <p className="text-[13px] font-bold leading-none text-foreground">{value}</p>
      <p className="text-center text-[9px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * The barber's working list for the day: every client in route order, with the one action
 * that finishes them off. Checkout stays closed until it is pressed.
 */
export default function ExecutionList({ stops, drivingTimes, completedSet, finalised, stats, onCheckout }) {
  if (stops.length === 0) {
    return (
      <div className="px-8 py-20 text-center">
        <ListOrdered className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-40" />
        <p className="text-sm font-semibold text-muted-foreground">No clients on this day</p>
        <p className="mt-1 text-xs text-muted-foreground/60">Use the Schedule tab to plan this day.</p>
      </div>
    );
  }

  return (
    <div className="pb-2">
      <div className="mx-4 mb-3 grid grid-cols-4 gap-2 rounded-2xl border border-border bg-card px-2 py-3">
        <Stat icon={<ListOrdered className="h-4 w-4" />} value={stats.stops} label="Stops" />
        <Stat icon={<Car className="h-4 w-4" />} value={fmtMins(stats.driveMins)} label="Drive" />
        <Stat icon={<Scissors className="h-4 w-4" />} value={fmtMins(stats.serviceMins)} label="Service" />
        <Stat icon={<Clock className="h-4 w-4" />} value={stats.efficiency ? `${stats.efficiency}%` : '—'} label="Efficiency" />
      </div>

      {!finalised && (
        <p className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          This day has not been finalised yet. Finalise it on the Calendar first — then each Checkout here will complete the stop and take the money.
        </p>
      )}

      <div className="mx-4 overflow-hidden rounded-2xl border border-border bg-card">
        {stops.map((stop, i) => (
          <ExecutionRow
            key={stop.id}
            stop={stop}
            index={i + 1}
            drive={i === 0 ? null : drivingTimes[`${stops[i - 1].id}_${stop.id}`]}
            completed={completedSet.has(stop.id)}
            onCheckout={onCheckout}
          />
        ))}
      </div>
    </div>
  );
}