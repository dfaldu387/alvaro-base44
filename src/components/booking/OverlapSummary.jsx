import React from 'react';
import { countToDemandLevel } from '@/lib/demandUtils';

const LEVELS = {
  available:   { dot: '🟢', label: 'Available',            color: 'text-green-400' },
  high_demand: { dot: '🟡', label: 'Popular',              color: 'text-yellow-400' },
  limited:     { dot: '🔴', label: 'Limited Availability', color: 'text-red-400' },
  unavailable: { dot: '⚫', label: 'Waitlist Only',        color: 'text-muted-foreground' },
};

const ORDER = ['available', 'high_demand', 'limited', 'unavailable'];
function worstLevel(levels) {
  return levels.reduce((worst, lvl) => ORDER.indexOf(lvl) > ORDER.indexOf(worst) ? lvl : worst, 'available');
}

const SUMMARIES = {
  available:   null, // suppress when all green — no noise
  high_demand: 'A wider availability window may improve your chances of confirmation.',
  limited:     'This window may be harder to accommodate. Consider extending your availability if possible.',
  unavailable: 'Your selected window currently overlaps periods operating on a waitlist.',
};

export default function OverlapSummary({ overlapBlocks, dayCounts }) {
  if (!overlapBlocks || overlapBlocks.length === 0) return null;

  const blockLevels = overlapBlocks.map(b => ({
    name: b,
    level: countToDemandLevel(dayCounts[b] || 0),
  }));

  const overall = worstLevel(blockLevels.map(b => b.level));

  // If all Available, show nothing — clean experience
  if (overall === 'available') return null;

  const summary = SUMMARIES[overall];
  const allSame = blockLevels.every(b => b.level === overall);

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Availability</p>
      <div className="space-y-1.5">
        {allSame ? (
          // Single line when all blocks share the same level
          <div className="flex items-center gap-2">
            <span className="text-sm">{LEVELS[overall].dot}</span>
            <span className={`text-sm font-medium ${LEVELS[overall].color}`}>{LEVELS[overall].label} across your window</span>
          </div>
        ) : (
          blockLevels.map(({ name, level }) => {
            const cfg = LEVELS[level];
            return (
              <div key={name} className="flex items-center gap-2">
                <span className="text-sm">{cfg.dot}</span>
                <span className={`text-sm font-medium ${cfg.color}`}>{name} — {cfg.label}</span>
              </div>
            );
          })
        )}
      </div>
      {summary && (
        <p className="text-xs text-muted-foreground leading-relaxed pt-1.5 border-t border-border">{summary}</p>
      )}
    </div>
  );
}