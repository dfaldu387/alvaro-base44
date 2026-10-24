import React from 'react';

const COLOURS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

// Dark-themed zone colour selector with preset swatches and custom hex input.
export default function ColourSelector({ value, onChange, disabled }) {
  const current = value || '#7c3aed';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2.5">
        {COLOURS.map((c) => {
          const selected = current.toLowerCase() === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              onClick={() => !disabled && onChange(c)}
              disabled={disabled}
              aria-label={`Select colour ${c}`}
              className={`w-8 h-8 rounded-full border-2 transition-all shrink-0 ${selected ? 'border-white ring-2 ring-[#6366f1] scale-110' : 'border-[#27272a] hover:scale-105'} disabled:opacity-50`}
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 shrink-0">Custom</span>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="#7c3aed"
          className="w-24 rounded-lg border border-[#27272a] bg-[#222226] px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#6366f1] disabled:opacity-50"
        />
      </div>
    </div>
  );
}