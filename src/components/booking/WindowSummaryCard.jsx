import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { countToDemandLevel } from '@/lib/demandUtils';

const DEMAND_CONFIG = {
  available:   { dot: '🟢', label: 'Available', color: 'text-green-400',  potentialLabel: 'High',     potentialColor: 'text-green-400' },
  high_demand: { dot: '🟡', label: 'Popular',   color: 'text-yellow-400', potentialLabel: 'Good',     potentialColor: 'text-yellow-400' },
  limited:     { dot: '🔴', label: 'Limited',   color: 'text-red-400',    potentialLabel: 'Moderate', potentialColor: 'text-yellow-500' },
};

const POTENTIAL_MAP = {
  available:   { label: 'High',     color: 'text-green-400' },
  high_demand: { label: 'Good',     color: 'text-yellow-400' },
  limited:     { label: 'Moderate', color: 'text-yellow-500' },
};

const SUGGESTIONS = {
  available:   'This window has strong availability.',
  high_demand: 'Part of your window overlaps a high-demand period.',
  limited:     'Earlier time slots in the day have more availability.',
};

function worstLevel(levels) {
  if (levels.includes('limited') || levels.includes('unavailable')) return 'limited';
  if (levels.includes('high_demand')) return 'high_demand';
  return 'available';
}

export default function WindowSummaryCard({ overlapBlocks, dayCounts }) {
  if (!overlapBlocks || overlapBlocks.length === 0) return null;

  // Build per-block info
  // TIME_BLOCK_RANGES has the canonical label per period name
  const BLOCK_LABELS = { Morning: '9am–12pm', Midday: '12pm–3pm', Afternoon: '3pm–6pm', Evening: '6pm–9pm' };

  const blockInfos = overlapBlocks.map(name => {
    const raw = countToDemandLevel(dayCounts[name] || 0);
    const level = raw === 'unavailable' ? 'limited' : raw;
    return { name, level, label: BLOCK_LABELS[name] || '' };
  });

  const worst = worstLevel(blockInfos.map(b => b.level));
  const demandCfg = DEMAND_CONFIG[worst] || DEMAND_CONFIG.available;
  const potentialCfg = POTENTIAL_MAP[worst] || POTENTIAL_MAP.available;
  const suggestion = SUGGESTIONS[worst];

  return (
    <div className="space-y-3">
      {/* About your selected window */}
      <div className="bg-card border border-border rounded-2xl p-4">
        <p className="text-sm font-semibold text-foreground mb-3">About your selected window</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {/* Overlaps */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Overlaps</p>
            <div className="space-y-1">
              {blockInfos.map(b => {
                const cfg = DEMAND_CONFIG[b.level] || DEMAND_CONFIG.available;
                return (
                  <div key={b.name} className="flex items-center gap-1.5">
                    <span className="text-xs">{cfg.dot}</span>
                    <span className="text-xs text-foreground">{b.name}{b.label ? ` (${b.label})` : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Demand */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Demand</p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{demandCfg.dot}</span>
              <span className={`text-xs font-medium ${demandCfg.color}`}>{demandCfg.label}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border mt-3 pt-3 grid grid-cols-2 gap-x-4 items-start">
          {/* Confirmation Potential */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Confirmation Potential</p>
            <p className={`text-sm font-bold ${potentialCfg.color}`}>{potentialCfg.label}</p>
          </div>

          {/* Suggestion */}
          <div className="flex items-start gap-2">
            <span className="text-sm mt-0.5">💡</span>
            <p className="text-xs text-muted-foreground leading-relaxed">{suggestion}</p>
          </div>
        </div>
      </div>

      {/* Important card */}
      <div className="bg-red-950/40 border border-red-500/30 rounded-2xl px-4 py-3.5 flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-red-300 mb-0.5">Important</p>
          <p className="text-xs text-red-200/70 leading-relaxed">
            Please ensure you're available for the entire selected window.
          </p>
        </div>
      </div>
    </div>
  );
}