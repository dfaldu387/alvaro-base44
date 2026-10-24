import React from 'react';

/**
 * The calendar's first-paint placeholder: an outline of the grid, not a spinner.
 *
 * A single loading state for the whole workspace would blank the toolbar, the
 * requests column and the day bar — so this stands in for the GRID alone, and only
 * until the first load lands. Everything reloaded afterwards keeps its content on
 * screen and never shows this again.
 */

const DAYS = [0, 1, 2, 3, 4];

export default function CalendarSkeleton() {
  return (
    <div className="h-full bg-white" aria-busy="true" aria-label="Loading the calendar">
      {/* Day headers */}
      <div className="flex border-b border-zinc-200">
        <div className="w-16 shrink-0 border-r border-zinc-200" />
        {DAYS.map((i) => (
          <div key={i} className="flex-1 border-l border-zinc-200 py-3">
            <div className="mx-auto h-2 w-8 animate-pulse rounded bg-zinc-100" />
            <div className="mx-auto mt-2 h-6 w-6 animate-pulse rounded-full bg-zinc-100" />
          </div>
        ))}
      </div>

      {/* A few cards where appointments would be, and the hour rules behind them */}
      <div className="flex pt-4">
        <div className="w-16 shrink-0 space-y-9 pr-2.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="ml-auto h-2 w-6 animate-pulse rounded bg-zinc-100" />
          ))}
        </div>
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${DAYS.length}, minmax(0, 1fr))` }}>
          {DAYS.map((i) => (
            <div key={i} className="relative border-l border-zinc-200">
              {[0, 1, 2, 3, 4, 5].map((r) => (
                <div key={r} className="border-t border-zinc-100" style={{ height: 60 }} />
              ))}
              {i % 2 === 0 && (
                <div
                  className="absolute left-1 right-1 animate-pulse rounded-lg bg-[#f4f1fd]"
                  style={{ top: 40 + i * 12, height: 76 }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}