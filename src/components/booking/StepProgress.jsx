import React from 'react';

// 5-step progress indicator: Location → Services → Availability → Details → Review
// A hairline rail with a filled portion, the current step named in full, and a
// quiet "Step X of N". Readable at 360px without horizontal scroll.
export default function StepProgress({ currentStep, labels }) {
  const total = labels.length;

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="font-heading text-xl font-bold tracking-tight text-foreground">
          {labels[currentStep - 1]}
        </p>
        <p className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Step {currentStep} of {total}
        </p>
      </div>

      <div className="flex items-center gap-1.5" role="presentation">
        {labels.map((label, i) => {
          const done = i + 1 < currentStep;
          const active = i + 1 === currentStep;
          return (
            <span
              key={i}
              title={label}
              className={`h-[3px] flex-1 rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                done ? 'bg-primary/50' : active ? 'bg-primary' : 'bg-white/[0.08]'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
