import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import FavouriteStar from '@/components/FavouriteStar';
import TimeBlockMenu from '@/components/schedule/TimeBlockMenu';

/**
 * The interior of a calendar appointment card (week and day views).
 *
 * Read top to bottom, exactly as the card is scanned, and nothing else competes:
 *   time (small purple) — with the one-tap controls opposite it
 *   client name ("Emily, T") — the strongest thing on the card
 *   service (small, grey) — with the duration pill in the lower-right corner
 *
 * Height is time, not padding: the card's content packs together against its top
 * edge, so a longer booking reads as the same card with room beneath it rather than
 * a few lines pulled apart across the middle. Below the compact threshold the card
 * carries its time and name only — the two things it is scanned for.
 *
 * The card is deliberately LIGHT: a dark block on a planning board reads as a
 * locked slot. The shell (fill, border, shadow) is drawn by the parent, which knows
 * where the card sits; this file owns what is written on it. What the appointment
 * IS is written here — never told apart by colour.
 */
/** Below this a card carries its time and name only. */
const COMPACT_PX = 48;
const TINY_PX = 30;

/** "Emily Davidson" → "Emily, T". First name, last initial — on every card. */
export function compactName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}, ${parts[parts.length - 1][0].toUpperCase()}`;
}

/** "45m", "1h", "1h 15m". */
export function durationLabel(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const rest = n % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** The duration, in the lower-right corner. One quiet style for every service. */
const DURATION_PILL = 'shrink-0 rounded-md border border-violet-300 bg-violet-100 px-1.5 py-[1px] text-[10px] font-bold leading-none tabular-nums text-violet-800';

const Badge = ({ className, children }) => (
  <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-[1px] text-[8px] font-bold uppercase leading-none tracking-wide', className)}>
    {children}
  </span>
);

export default function AppointmentBlockContent({
  appt, startLabel, heightPx, nameMode = 'compact', showMenu = false, onToggleFavourite, menuItems = [],
}) {
  const compact = heightPx < COMPACT_PX;
  const tiny = heightPx < TINY_PX;
  const isCancelled = appt.status === 'cancelled';
  const isCompleted = appt.status === 'completed';
  const name = nameMode === 'compact' ? compactName(appt.clientName) : appt.clientName;
  // Up to two services, never cut to fit: the line wraps before it is truncated.
  const service = (appt.services || []).slice(0, 2).join(' + ');
  const badge = durationLabel(appt.duration || (appt.apptEnd - appt.apptStart) * 60);
  const awaitingReply = appt.availability_override && appt.override_status === 'awaiting_confirmation';

  return (
    <div className={cn(
      'relative flex min-w-0 flex-1 flex-col px-2 py-1',
      // Content is packed from the top of the card: a longer booking is the same
      // card with room beneath it, never the same amount of text stretched to fill it.
      compact ? 'justify-center gap-[2px]' : 'justify-start gap-[3px]',
    )}>
      {/* Time and client name travel together at the top of the card, so a tall card
          opens the same way a short one does. */}
      <div className="flex min-w-0 flex-col gap-[2px]">
        {/* Start time, with the one-tap controls opposite it */}
        <div className="flex items-center gap-1">
          {!tiny && (
            <span className={cn(
              'text-[10px] font-semibold leading-none tabular-nums',
              isCancelled ? 'text-zinc-400' : 'text-violet-700',
            )}>
              {startLabel}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {!appt.isBlock && (
              <FavouriteStar
                tone="light"
                size="xs"
                isFavourite={appt.is_favourite}
                onToggle={() => onToggleFavourite?.(appt)}
                name={appt.clientName}
                // Visible, but never louder than the client's name: the outline star
                // is drawn in the card's own purple rather than near-invisible grey.
                starClassName={appt.is_favourite ? undefined : 'text-violet-400'}
              />
            )}
            {/* The same three-dot menu, in the same corner, as blocked time. */}
            {showMenu && !appt.isBlock && !compact && menuItems.length > 0 && (
              <TimeBlockMenu items={menuItems} label="Appointment actions" />
            )}
          </div>
        </div>

        {/* Client name — the most readable thing on the card */}
        <div className="flex min-w-0 items-center gap-1">
          <p className={cn(
            'truncate text-[13px] font-bold leading-tight tracking-tight',
            isCancelled ? 'text-zinc-400 line-through' : 'text-[#241a3d]',
          )}>
            {name}
          </p>
          {!isCancelled && !isCompleted && appt.is_new_client && (
            <Badge className="border-violet-300 bg-violet-100 text-violet-700">New</Badge>
          )}
          {!isCancelled && !isCompleted && appt.needs_attention && (
            <Badge className="border-amber-300 bg-amber-100 text-amber-800">Attention</Badge>
          )}
          {!isCancelled && !isCompleted && awaitingReply && (
            <Badge className="border-amber-300 bg-amber-100 text-amber-800">Awaiting reply</Badge>
          )}
          {!isCancelled && !isCompleted && appt.customer_confirmed && (
            <Badge className="border-emerald-300 bg-emerald-100 text-emerald-700">
              <Check className="h-2 w-2" />Confirmed
            </Badge>
          )}
        </div>
      </div>

      {/* What the appointment is — small and grey, with its duration in the
          lower-right corner, which is where it always is. */}
      {!compact && (
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span className={cn(
            'min-w-0 line-clamp-2 text-[11px] leading-[1.25]',
            isCancelled || isCompleted ? 'text-zinc-400' : 'text-zinc-500',
          )}>
            {service}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {isCompleted && (
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                <Check className="h-2 w-2" />Completed
              </Badge>
            )}
            {isCancelled && <Badge className="border-zinc-200 bg-zinc-100 text-zinc-500">Cancelled</Badge>}
            {badge && <span className={DURATION_PILL}>{badge}</span>}
          </span>
        </div>
      )}
    </div>
  );
}