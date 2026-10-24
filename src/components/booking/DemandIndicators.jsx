import React from 'react';
import { DAY_PERIODS, countToDemandLevel } from '@/lib/demandUtils';

const LEVELS = {
  available:    { dot: '🟢', label: 'Available',            color: 'text-green-400',        desc: 'Good availability — requests likely to be accommodated' },
  high_demand:  { dot: '🟡', label: 'Popular',              color: 'text-yellow-400',       desc: 'A wider window may improve confirmation chances' },
  limited:      { dot: '🔴', label: 'Limited Availability', color: 'text-red-400',          desc: 'High demand — confirmation may be more difficult' },
  unavailable:  { dot: '⚫', label: 'Join Waitlist',        color: 'text-muted-foreground', desc: 'This period is currently unavailable' },
};

export default function DemandIndicators({ day, counts, highlight = [] }) {
  const periods = DAY_PERIODS[day] || [];

  return (
    <div className="grid grid-cols-2 gap-2">
      {periods.map(p => {
        const lvl = countToDemandLevel(counts[p.name] || 0);
        const cfg = LEVELS[lvl];
        const active = highlight.includes(p.name);
        return (
          <div
            key={p.name}
            className={`rounded-xl border px-3 py-2.5 transition-all ${active ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'}`}
          >
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-medium text-foreground">{p.name}</span>
              <span className="text-xs">{cfg.dot}</span>
            </div>
            <p className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5 leading-tight">{cfg.desc}</p>
          </div>
        );
      })}
    </div>
  );
}