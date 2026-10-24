import React from 'react';

export const DEMAND_MAP = {
  high_availability: { emoji: '🟢', label: 'Best Availability', color: 'text-green-400' },
  limited:           { emoji: '🟡', label: 'Limited Availability', color: 'text-yellow-400' },
  high_demand:       { emoji: '🔴', label: 'High Demand', color: 'text-red-400' },
};

export default function DemandBadge({ level, compact = false }) {
  const info = DEMAND_MAP[level] || DEMAND_MAP.high_availability;

  if (compact) {
    return <span className="text-sm">{info.emoji}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${info.color}`}>
      <span>{info.emoji}</span>
      <span>{info.label}</span>
    </span>
  );
}