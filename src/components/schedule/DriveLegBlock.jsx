import React from 'react';
import { AlertTriangle, Car } from 'lucide-react';
import { driveTone } from '@/lib/driveTime';

/**
 * A drive leg between two connected appointments.
 *
 * The calendar owns the pixel scale and hands this component the room genuinely
 * free between two cards (maxHeightPx). Every leg the day holds is drawn here: a
 * segment is never hidden because its travel could not be estimated or because it
 * does not fit. Those two are shown as Travel unavailable and Travel conflict with
 * the earliest feasible start, because a route segment that disappears silently is
 * worse than one that says what is wrong with it.
 */
/** The height a pill needs to be readable. Less room than this and only the line is drawn. */
const PILL_ROOM_PX = 20;

function DottedLine() {
  return (
    <span
      className="w-px min-h-0 flex-1"
      style={{ backgroundImage: 'repeating-linear-gradient(to bottom, #a78bfa 0 4px, transparent 4px 9px)' }}
    />
  );
}

export default function DriveLegBlock({ topPx, maxHeightPx, leg, label = 'Drive', insetClass = 'left-2 right-2' }) {
  if (!leg || maxHeightPx == null) return null;

  const state = leg.state || 'ok';
  const mins = leg.mins == null ? null : Math.max(0, Math.round(leg.mins));
  const room = Math.max(maxHeightPx - 2, 0);
  // Two appointments at one address are still a leg — it is labelled, never dropped.
  const sameLocation = state === 'ok' && mins === 0;
  const legLabel = sameLocation ? 'Same location' : label;

  // A pill needs room to be read. With none at all (two cards back to back, or a gap a
  // drive cannot fit in) the dotted line alone carries the route on: the sequence stays
  // visibly connected and no label is ever drawn over an appointment.
  if (room < PILL_ROOM_PX) {
    return (
      <div
        className={`absolute ${insetClass} z-[15] flex flex-col items-center pointer-events-none`}
        style={{ top: `${topPx + 1}px`, height: `${room}px` }}
      >
        <DottedLine />
      </div>
    );
  }

  const tone = driveTone(mins);
  const unavailable = state === 'unavailable';
  const conflict = state === 'conflict';

  return (
    <div
      className={`absolute ${insetClass} z-[15] flex flex-col items-center pointer-events-none`}
      style={{ top: `${topPx + 1}px`, height: `${room}px` }}
      title={unavailable
        ? `Travel unavailable between these two appointments — ${label.toLowerCase()} flagged for review`
        : conflict
        ? `Travel conflict: ${mins} min drive needed${leg.gap != null ? `, only ${leg.gap} min free` : ''}${leg.earliest ? ` · earliest feasible start ${leg.earliest}` : ''}`
        : `${legLabel} · ${mins} min`}
    >
      <DottedLine />

      {unavailable ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-amber-500/70 bg-amber-50 px-2 py-[3px] shadow-sm">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
          <span className="whitespace-nowrap text-[10px] font-bold leading-none text-amber-700">Travel unavailable</span>
        </span>
      ) : conflict ? (
        <span className="flex shrink-0 flex-col items-center gap-[2px] rounded-lg border border-red-500/70 bg-red-50 px-2 py-[3px] shadow-sm">
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" />
            <span className="whitespace-nowrap text-[10px] font-bold leading-none text-red-700">Travel conflict</span>
          </span>
          <span className="whitespace-nowrap text-[9px] font-semibold leading-none text-red-600">
            {mins}m drive{leg.gap != null ? ` · ${leg.gap}m free` : ''}
          </span>
          {leg.earliest && (
            <span className="whitespace-nowrap text-[9px] font-semibold leading-none text-red-600/90">
              earliest {leg.earliest}
            </span>
          )}
        </span>
      ) : (
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] shadow-sm ${tone.pill}`}>
          <Car className={`h-3 w-3 shrink-0 ${tone.icon}`} />
          <span className="whitespace-nowrap text-[10px] font-bold leading-none tabular-nums">
            {legLabel} · {mins}m
          </span>
        </span>
      )}

      <DottedLine />
    </div>
  );
}