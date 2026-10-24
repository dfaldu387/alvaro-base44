import React from 'react';
import { Info } from 'lucide-react';

/**
 * The Calendar's philosophy, stated once, above the grid: the barber may drag
 * appointments anywhere, and preferred availability is a preference the client
 * is asked about — not a boundary the system enforces.
 */
export default function ManualSchedulingHint() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2 sm:px-6">
      <Info className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
      <p className="text-[11px] font-medium leading-snug text-indigo-700">
        Drag appointments anywhere. If outside <span className="font-bold">preferred availability</span>, the client receives a <span className="font-bold">confirmation</span> message.
      </p>
    </div>
  );
}