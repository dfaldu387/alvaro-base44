import React from 'react';
import { Car, Info } from 'lucide-react';

/**
 * Bottom drive-efficiency status bar.
 * Left: label + legend dots. Right: weekly appointment count.
 */
export default function RouteLegend({ count = 0, newClientsThisMonth = 0, placing = false }) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-t border-zinc-200 bg-white shrink-0">
      {/* Left: label + legend */}
      <div className="flex items-center gap-4">
        {/* While a request is being dragged the legend explains the three readings the
            drop can get, so the colours on the grid are never a guessing game. */}
        {placing ? (
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold text-zinc-500">Drop</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-zinc-500">Valid · fits the customer's time</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-[10px] text-zinc-500">Override required · outside customer availability</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-[10px] text-zinc-500">Invalid · cannot be placed</span>
            </div>
          </div>
        ) : (
        <>
        <div className="flex items-center gap-1.5">
          <Car className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[11px] text-zinc-500 font-semibold">Drive Efficiency</span>
          <Info className="w-3 h-3 text-zinc-600" />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-[10px] text-zinc-500">≤ 15 min</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="text-[10px] text-zinc-500">≤ 20 min</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-[10px] text-zinc-500">&gt; 20 min</span>
          </div>
        </div>
        </>
        )}
      </div>
      {/* Right: new clients this month + weekly count */}
      <div className="flex items-center gap-4">
        <span className="text-[11px] text-zinc-500 font-medium">
          New clients this month: <span className="text-zinc-800 font-bold">{newClientsThisMonth}</span>
        </span>
        <span className="text-[11px] text-zinc-500 font-medium">
          {count} {count === 1 ? 'appointment' : 'appointments'} this week
        </span>
      </div>
    </div>
  );
}