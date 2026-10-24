import React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { DAY_PERIODS, decimalToLabel, countToDemandLevel } from '@/lib/demandUtils';

const DEMAND_CONFIG = {
  available:   { label: 'Available',   color: 'text-green-400',  dot: 'bg-green-400',  bar: 'bg-green-600',   barText: 'text-white' },
  high_demand: { label: 'Popular',     color: 'text-yellow-400', dot: 'bg-yellow-400', bar: 'bg-yellow-500',  barText: 'text-black' },
  limited:     { label: 'Limited',     color: 'text-red-400',    dot: 'bg-red-500',    bar: 'bg-red-600',     barText: 'text-white' },
  unavailable: { label: 'Limited',     color: 'text-red-400',    dot: 'bg-red-500',    bar: 'bg-red-700',     barText: 'text-white' },
};

export default function AvailabilitySlider({ day, value, onChange, minWindowMins = 0, dayCounts = {} }) {
  const periods = DAY_PERIODS[day] || [];
  const min = periods.length ? periods[0].start : 9;
  const max = periods.length ? periods[periods.length - 1].end : 18;

  const minWindowHours = Math.ceil((minWindowMins / 60) * 2) / 2;

  const handleChange = (newValue) => {
    const gap = Math.max(0.5, minWindowHours);
    if (newValue[1] - newValue[0] < gap) {
      if (newValue[0] !== value[0]) {
        onChange([Math.min(newValue[0], newValue[1] - gap), newValue[1]]);
      } else {
        onChange([newValue[0], Math.max(newValue[1], newValue[0] + gap)]);
      }
      return;
    }
    onChange(newValue);
  };

  // Window label
  const windowHours = value[1] - value[0];
  const windowLabel = (() => {
    const h = Math.floor(windowHours);
    const m = Math.round((windowHours % 1) * 60);
    if (h > 0 && m > 0) return `${h} hr ${m} min`;
    if (h > 0) return `${h} hour${h > 1 ? 's' : ''}`;
    return `${m} min`;
  })();

  return (
    <div className="space-y-0">
      {/* Operating hours row */}
      <div className="flex justify-between text-xs text-muted-foreground px-0.5 mb-1.5">
        <span>{decimalToLabel(min)}</span>
        <span>{decimalToLabel(max)}</span>
      </div>

      {/* Segmented time-block bar */}
      {periods.length > 0 && (
        <div className="flex w-full rounded-xl overflow-hidden mb-1">
          {periods.map((p, i) => {
            const rawLevel = countToDemandLevel(dayCounts[p.name] || 0);
            const level = rawLevel === 'unavailable' ? 'limited' : rawLevel;
            const cfg = DEMAND_CONFIG[level];
            const isFirst = i === 0;
            const isLast = i === periods.length - 1;
            return (
              <div
                key={p.name}
                className={`flex-1 ${cfg.bar} flex flex-col items-center justify-center py-2.5 px-1
                  ${isFirst ? 'rounded-l-xl' : ''}
                  ${isLast ? 'rounded-r-xl' : ''}
                  ${!isLast ? 'border-r border-black/20' : ''}
                `}
              >
                <span className={`text-xs font-bold ${cfg.barText} leading-tight`}>{p.name}</span>
                <span className={`text-[10px] ${cfg.barText} opacity-80 mt-0.5`}>{p.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Demand status row */}
      {periods.length > 0 && (
        <div className="flex w-full mb-3">
          {periods.map((p) => {
            const rawLevel = countToDemandLevel(dayCounts[p.name] || 0);
            const level = rawLevel === 'unavailable' ? 'limited' : rawLevel;
            const cfg = DEMAND_CONFIG[level];
            return (
              <div key={p.name} className="flex-1 flex flex-col items-center gap-1 pt-2">
                <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                <span className={`text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Range slider */}
      <SliderPrimitive.Root
        className="relative flex w-full touch-none select-none items-center py-2"
        min={min}
        max={max}
        step={0.5}
        value={value}
        onValueChange={handleChange}
        minStepsBetweenThumbs={Math.max(1, minWindowHours / 0.5)}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="block h-7 w-7 rounded-full border-2 border-primary bg-background shadow-lg shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing"
          aria-label="Available from"
        />
        <SliderPrimitive.Thumb
          className="block h-7 w-7 rounded-full border-2 border-primary bg-background shadow-lg shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing"
          aria-label="Available until"
        />
      </SliderPrimitive.Root>

      {/* Selected window display */}
      <div className="pt-3 text-center">
        <p className="text-xs text-muted-foreground mb-1">Selected Window</p>
        <p className="text-2xl font-bold text-foreground font-heading tracking-tight">
          {decimalToLabel(value[0])} – {decimalToLabel(value[1])}
        </p>
        <p className="text-sm text-muted-foreground mt-1">{windowLabel}</p>
      </div>
    </div>
  );
}