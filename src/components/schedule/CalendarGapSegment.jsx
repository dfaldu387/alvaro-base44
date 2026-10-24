import React from 'react';
import { AlertTriangle, Car } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { driveTone } from '@/lib/driveTime';
import { decimalToLabel } from '@/lib/timeUtils';

/**
 * One piece of the time between two appointments, drawn where it actually is.
 *
 * Driving is the coloured pill the calendar has always used — car icon and the
 * real duration, rated green / yellow / red. Everything else is a quiet dashed
 * box so a gap can always be read at a glance: a configured buffer, time held by
 * a fixed commitment, or genuinely unnecessary idle time. Tap any of them and it
 * says why it is there and what would have to change for it to close.
 */
const BOX = {
  buffer: 'border-zinc-200 bg-zinc-100/80 text-zinc-500',
  fixed: 'border-dashed border-zinc-300 bg-zinc-50 text-zinc-600',
  idle: 'border-dashed border-red-300 bg-red-50 text-red-700',
  unknown: 'border-dashed border-zinc-300 bg-zinc-100 text-zinc-500',
};

const SHORT = {
  buffer: (s) => `${s.minutes}m buffer`,
  fixed: (s) => `${s.minutes}m fixed`,
  idle: (s) => `${s.minutes}m idle`,
  unknown: () => 'Drive not verified',
  conflict: () => 'Travel conflict',
};

/** A pill needs room to be legible; below this only the coloured line is drawn. */
const PILL_ROOM = 20;

export default function CalendarGapSegment({ segment, top, height, insetClass }) {
  const room = Math.max(0, height - 2);
  const drive = segment.kind === 'drive';
  const conflict = segment.kind === 'conflict';
  const tone = drive || conflict ? driveTone(segment.minutes) : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-gap-reason={segment.kind}
          aria-label={`${segment.minutes} minutes, ${segment.label}. Show why this gap is here`}
          title={`${segment.minutes} min · ${segment.label}`}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          className={`absolute ${insetClass} z-[15] flex flex-col items-stretch overflow-visible focus-visible:outline-none`}
          style={{ top: top + 1, height: room }}
        >
          {tone && room >= PILL_ROOM ? (
            <>
              <span className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold leading-none shadow-sm ${tone.pill}`}>
                {conflict ? <AlertTriangle className="h-3 w-3" /> : <Car className={`h-3 w-3 ${tone.icon}`} />}
                {conflict ? 'Travel conflict' : `${segment.minutes}m drive`}
              </span>
              <span className={`mx-auto mt-0.5 w-px flex-1 ${tone.bar}`} />
            </>
          ) : tone ? (
            <span className={`mx-auto w-0.5 flex-1 rounded-full ${tone.bar}`} />
          ) : room >= PILL_ROOM ? (
            <span className={`truncate rounded border px-1 py-0.5 text-[10px] font-semibold leading-none ${BOX[segment.kind] || BOX.unknown}`}>
              {SHORT[segment.kind]?.(segment) || `${segment.minutes}m`}
            </span>
          ) : (
            <span className={`mx-auto w-0.5 flex-1 rounded-full ${segment.kind === 'idle' ? 'bg-red-300' : 'bg-zinc-300'}`} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[80] w-72 max-w-[90vw] space-y-1.5 bg-popover p-3 text-popover-foreground" onPointerDown={e => e.stopPropagation()}>
        <p className="text-xs font-bold">{segment.minutes} min · {segment.label}</p>
        <p className="text-[11px] text-muted-foreground">{decimalToLabel(segment.start)}–{decimalToLabel(segment.end)}</p>
        {segment.details.map((detail, i) => (
          <p key={i} className="text-[11px] leading-relaxed">{detail}</p>
        ))}
      </PopoverContent>
    </Popover>
  );
}