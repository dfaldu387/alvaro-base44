import React from 'react';
import { Home, Navigation } from 'lucide-react';
import { decimalToLabel } from '@/lib/timeUtils';

/**
 * The first leg of the day: where the barber starts, and how long it takes to
 * reach the first stop. A route runs start location → first appointment → drive
 * leg → next appointment, so the start is part of the route, not a detail.
 */
export default function RouteStartBlock({ startLocation, firstLegMinutes, firstStart }) {
  const configured = !!startLocation && Number.isFinite(Number(firstLegMinutes));
  const leaveBy = configured && Number.isFinite(Number(firstStart))
    ? decimalToLabel(Number(firstStart) - Number(firstLegMinutes) / 60)
    : null;

  return (
    <div className="flex items-start">
      <div className="w-14 shrink-0 text-right pr-2 pt-2.5">
        {leaveBy && <span className="text-[11px] font-medium text-muted-foreground leading-none">{leaveBy}</span>}
      </div>

      <div className="flex flex-col items-center shrink-0 mr-2.5" style={{ width: 28 }}>
        <div className="w-7 h-7 rounded-full border-2 border-border bg-card flex items-center justify-center shrink-0">
          <Home className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="w-px flex-1 bg-border mt-1" style={{ minHeight: 24 }} />
      </div>

      <div className="flex-1 pb-2">
        <div className="rounded-2xl border border-border bg-card px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-muted-foreground tracking-[0.16em] uppercase mb-1">Start</p>
              <p className="text-[13px] font-bold text-foreground truncate">
                {startLocation || 'Start location not set'}
              </p>
            </div>
            <Navigation className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {configured
              ? `${firstLegMinutes} min drive to the first stop`
              : 'Add a start location to the barber profile to verify the first leg.'}
          </p>
        </div>
      </div>
    </div>
  );
}