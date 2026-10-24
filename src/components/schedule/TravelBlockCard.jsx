/**
 * TravelBlockCard — renders a drive-time block between two appointments.
 *
 * A drive block is real scheduled time, not an overlay. It starts when the
 * previous appointment ends, uses the same time-to-pixel coordinate system as
 * appointment cards, and is clamped to the time genuinely available before the
 * next appointment — so it can never cover an appointment card.
 *
 * When the required travel does not fit in the gap, the block switches to a
 * travel-conflict state (it never overlaps the next appointment) and the
 * affected appointment is flagged on its own card.
 *
 * States:
 *  - loading:    calculating drive time (spinner)
 *  - stale:      a linked appointment moved, needs recalculation
 *  - connected:  normal drive block with efficiency colour
 *  - conflict:   not enough real time before the next appointment
 */
import React from 'react';
import { Car, X, RotateCw, GripVertical } from 'lucide-react';
import { EFFICIENCY_STYLES } from '@/lib/travelBlockUtils';
import { decimalToLabel } from '@/lib/timeUtils';

// Below this there is no usable room in the gap — drawing anything would cover
// the next appointment card, so the block renders nothing instead.
const MIN_VISIBLE_PX = 10;
// Short drives still get a readable block (time range + drive label)
const MIN_BLOCK_PX = 34;

/**
 * Drive block — its own slot on the calendar between two appointments.
 *
 * topPx and maxHeightPx describe the RENDERED gap (supplied by the calendar), so
 * the block starts clear below the card above and stops clear of the card below:
 * it can never be drawn over an appointment. Its height follows the drive
 * duration until the gap runs out.
 */
export default function TravelBlockCard({ block, fromAppt, toAppt, topPx = 0, maxHeightPx = null, pxPerHour, onRemove, onRecalculate }) {
  // Source appointment's end time is the block start (the scheduling truth)
  const blockStart = fromAppt?.apptEnd ?? block.start;
  const timeLabel = `${decimalToLabel(blockStart)} – ${decimalToLabel(blockStart + (block.durationMins ?? 0) / 60)}`;

  // Real time available between this appointment ending and the next starting
  const availableMins = toAppt ? (toAppt.apptStart - blockStart) * 60 : null;
  const clampToGap = (height) => (maxHeightPx == null ? height : Math.min(height, Math.max(maxHeightPx, 0)));

  // ── Loading ──────────────────────────────────────────────────────────────
  if (block.loading) {
    const height = clampToGap(28);
    if (height < MIN_VISIBLE_PX) return null;
    return (
      <div
        className="absolute left-2 right-2 rounded-xl flex items-center justify-center z-10"
        style={{
          top: `${topPx}px`, height: `${height}px`,
          background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)',
          border: '1px solid rgba(250,204,21,0.30)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-3 h-3 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Stale: needs recalculation ────────────────────────────────────────────
  if (block.stale) {
    const height = clampToGap(32);
    if (height < MIN_VISIBLE_PX) return null;
    return (
      <div
        className="absolute left-2 right-2 rounded-xl z-10 group"
        style={{
          top: `${topPx}px`, height: `${height}px`,
          background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)',
          border: '1px solid rgba(250,204,21,0.5)',
          boxShadow: '0 0 12px rgba(250,204,21,0.10)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 px-2 h-full">
          <Car className="w-3 h-3 shrink-0 text-yellow-500" />
          <span className="text-[10px] font-semibold truncate flex-1 text-amber-600/85">Drive • Needs recalculation</span>
          {onRecalculate && (
            <button
              onClick={(e) => { e.stopPropagation(); onRecalculate(block.id); }}
              className="flex items-center gap-0.5 text-[9px] font-semibold text-amber-600 hover:text-amber-700 shrink-0 transition-colors"
            >
              <RotateCw className="w-2.5 h-2.5" /> Recalc
            </button>
          )}
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(block.id); }}
              className="text-yellow-500/60 hover:text-amber-600 shrink-0 transition-colors"
              title="Remove drive block"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Connected or Conflict ────────────────────────────────────────────────
  const durationMins = block.durationMins ?? 0;
  const durationHeight = (durationMins / 60) * pxPerHour;
  // Its own height comes from the drive duration (with a readable minimum),
  // capped by the gap so it can never reach the next appointment card
  const blockHeight = clampToGap(Math.max(durationHeight, MIN_BLOCK_PX));
  const hasConflict = availableMins != null && durationMins > availableMins + 0.5; // 30s tolerance

  // No real room in the gap — the conflict is surfaced on the appointment card
  // rather than drawn over it.
  if (blockHeight < MIN_VISIBLE_PX) return null;

  const style = EFFICIENCY_STYLES[block.efficiency] || EFFICIENCY_STYLES.green;
  const accent = hasConflict ? '#b91c1c' : style.text;
  const isTall = blockHeight >= 30;

  // Optional suburb info (only when enough vertical space)
  const fromLabel = fromAppt?.location || (fromAppt?.address ? fromAppt.address.split(',')[0] : '');
  const toLabel = toAppt?.location || (toAppt?.address ? toAppt.address.split(',')[0] : '');

  return (
    <div
      className="absolute left-2 right-2 rounded-xl z-10 group flex overflow-hidden cursor-grab"
      style={{
        top: `${topPx}px`,
        height: `${blockHeight}px`,
        background: hasConflict ? 'linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%)' : style.bg,
        border: `1px solid ${hasConflict ? 'rgba(248,113,113,0.45)' : style.border}`,
        boxShadow: hasConflict ? '0 0 12px rgba(248,113,113,0.12)' : style.glow,
      }}
      onClick={(e) => e.stopPropagation()}
      title="Drive time — its own slot between appointments. Move the appointments to reposition it."
    >
      {/* Route accent strip, matching the appointment cards */}
      <div className="w-[3px] shrink-0" style={{ background: accent }} />
      <div className="flex-1 min-w-0 h-full flex flex-col justify-center px-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Car className="w-3 h-3 shrink-0" style={{ color: accent }} />
          <span className="text-[10px] font-bold truncate" style={{ color: accent }}>{timeLabel}</span>
          {isTall && (
            <GripVertical className="w-3 h-3 shrink-0 ml-auto opacity-40 group-hover:opacity-80 transition-opacity" style={{ color: style.text }} />
          )}
        </div>
        {isTall && (
          hasConflict ? (
            <span className="text-[9px] font-semibold truncate mt-0.5 text-red-700">
              Travel conflict · {durationMins} min needed
            </span>
          ) : (
            <span className="text-[9px] font-medium truncate mt-0.5" style={{ color: style.text, opacity: 0.75 }}>
              Drive • {durationMins} min
            </span>
          )
        )}
        {!hasConflict && fromLabel && toLabel && blockHeight > 56 && (
          <p className="text-[9px] truncate" style={{ color: style.text, opacity: 0.5 }}>
            {fromLabel} → {toLabel}
          </p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(block.id); }}
          className="self-start m-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 hover:bg-black/20"
          style={{ color: style.text }}
          title="Remove drive block"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}