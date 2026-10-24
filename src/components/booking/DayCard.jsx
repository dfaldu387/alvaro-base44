import React from 'react';
import { ChevronRight } from 'lucide-react';
import DemandBadge from './DemandBadge';
import { DAY_PERIODS, DAY_LATEST_START, PERIOD_CAPACITY, countToDemandLevel, dayDemandLevel } from '@/lib/demandUtils';

const COUNT_COLOR = {
  high_availability: 'text-green-400',
  limited: 'text-yellow-400',
  high_demand: 'text-red-400',
};

export default function DayCard({ day, dayRequests, counts, onSelect }) {
  const periods = DAY_PERIODS[day] || [];

  return (
    <button
      onClick={() => onSelect(day)}
      className="w-full rounded-2xl border border-border bg-card hover:border-primary/50 transition-all text-left overflow-hidden group"
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-heading font-bold text-foreground">{day}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <DemandBadge level={dayDemandLevel(day, dayRequests)} />
      </div>

      <div className="border-t border-border/60 divide-y divide-border/40">
        {periods.map(p => {
          const c = Math.min(counts[p.name] || 0, PERIOD_CAPACITY);
          const lvl = countToDemandLevel(counts[p.name] || 0);
          return (
            <div key={p.name} className="flex items-center justify-between px-5 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-foreground">{p.name}</span>
                <span className="text-[11px] text-muted-foreground">{p.label}</span>
              </div>
              <span className={`text-xs font-semibold tabular-nums ${COUNT_COLOR[lvl]}`}>
                {c}/{PERIOD_CAPACITY}
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-2 border-t border-border/60 bg-muted/20">
        <span className="text-[11px] text-muted-foreground">Latest start: {DAY_LATEST_START[day]}</span>
      </div>
    </button>
  );
}