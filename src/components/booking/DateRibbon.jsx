import React, { useEffect, useRef } from 'react';
import { AVAILABILITY_STATUS } from '@/lib/bookingDateUtils';

// Breathing room kept between a revealed card and the ribbon edge.
const EDGE_PAD = 10;

// Defensive card key — a missing or invalid date must never throw during render.
function keyOf(day, index) {
  const value = day?.date;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toDateString();
  return `day-${index}`;
}

function dateKeyOf(value) {
  return value instanceof Date && !isNaN(value.getTime()) ? value.toDateString() : null;
}

// Date carousel — each day shows the priority zone(s) for that day with a
// coloured dot + zone name. "Closed" for non-working days (disabled).
// Full days remain tappable (the parent shows an explanation).
//
// Selection and scrolling are deliberately independent:
//   • `selectedDate` (owned by the parent) is the single source of truth for the
//     chosen booking date — it drives the highlight, the heading and the panel.
//   • the scroll position belongs to the scroll container itself and is never
//     derived from `selectedDate`, so tapping a date changes only the selection
//     and swiping only moves the ribbon.
// Selecting a card nudges the ribbon by the minimum distance needed to keep that
// card on screen (nothing at all when it is already visible) — never a recentre,
// never a jump to a different group of days. Everything here is defensive: no
// amount of missing data or failed scrolling can break the booking page.
export default function DateRibbon({ days, selectedDate, onSelect }) {
  const scrollRef = useRef(null);
  const cardsRef = useRef(new Map());
  const list = Array.isArray(days) ? days : [];
  const selectedKey = dateKeyOf(selectedDate);

  useEffect(() => {
    if (!selectedKey) return;
    // Revealing the selected card is an enhancement only — it must never be
    // able to take the page down.
    try {
      const container = scrollRef.current;
      const card = cardsRef.current.get(selectedKey);
      if (!container || !card) return;

      // Measured viewport rectangles — unlike offsetLeft (which is relative to
      // an arbitrary offsetParent) these describe where the card really sits, so
      // the movement is exactly the overflow.
      const view = container.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      let delta = 0;
      if (box.left < view.left) delta = box.left - view.left - EDGE_PAD;
      else if (box.right > view.right) delta = box.right - view.right + EDGE_PAD;

      if (delta !== 0) container.scrollBy({ left: delta, behavior: 'smooth' });
    } catch {
      /* scrolling failed — the ribbon simply stays where it is */
    }
    // Runs on mount and when the customer selects a date — nothing else ever
    // moves the ribbon, so re-renders and manual swiping stay untouched.
  }, [selectedKey]);

  return (
    <div
      ref={scrollRef}
      className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
    >
      {list.map((d, i) => {
        const key = keyOf(d, i);
        const isSel = selectedKey !== null && selectedKey === key;
        const isClosed = d?.status === 'closed';
        const canTap = !isClosed && typeof onSelect === 'function';
        const zones = Array.isArray(d?.zones) ? d.zones : [];
        const statusInfo = AVAILABILITY_STATUS[d?.status];
        const ariaLabel = `${d?.dow || ''} ${d?.dateNum || ''}${zones.length === 1 ? `, ${zones[0]?.name || ''}` : zones.length > 1 ? `, ${zones.length} areas` : ''}${statusInfo ? `, ${statusInfo.label}` : ''}`;

        return (
          <button
            key={key}
            ref={(el) => {
              if (el) cardsRef.current.set(key, el);
              else cardsRef.current.delete(key);
            }}
            onClick={() => canTap && onSelect(d.date)}
            disabled={!canTap}
            aria-selected={isSel}
            aria-disabled={isClosed}
            aria-label={ariaLabel}
            className={`flex flex-col items-center gap-1 rounded-2xl px-2.5 py-2.5 min-w-[62px] shrink-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isSel
                ? 'bg-primary/20 border border-[#a855f7] text-white ring-2 ring-[#a855f7]/40 shadow-[0_0_18px_rgba(168,85,247,0.45)]'
                : isClosed
                  ? 'bg-card/40 border border-border/50 text-muted-foreground/70 cursor-not-allowed'
                  : 'bg-card border border-border text-foreground active:opacity-70'
            }`}
          >
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${isSel ? 'text-[#e9d5ff]' : ''}`}>{d?.dow}</span>
            <span className="text-[18px] font-bold leading-none">{d?.dateNum}</span>
            {isClosed ? (
              <span className="text-[9px] text-zinc-500">Closed</span>
            ) : (
              <>
                {zones.length === 1 ? (
                  <div className="flex items-center gap-1 max-w-full">
                    <span style={{ backgroundColor: zones[0]?.colour }} className="w-1.5 h-1.5 rounded-full shrink-0" />
                    <span className="text-[9px] truncate">{zones[0]?.name}</span>
                  </div>
                ) : zones.length > 1 ? (
                  <div className="flex items-center gap-1">
                    <div className="flex -space-x-0.5">
                      {zones.slice(0, 3).map((z, zi) => (
                        <span key={zi} style={{ backgroundColor: z?.colour }} className="w-1.5 h-1.5 rounded-full border border-card" />
                      ))}
                    </div>
                    <span className="text-[9px]">{zones.length} areas</span>
                  </div>
                ) : (
                  <span className="text-[9px] text-zinc-500">&mdash;</span>
                )}
                <span className={`w-1.5 h-1.5 rounded-full ${AVAILABILITY_STATUS[d?.status]?.dot || 'bg-green-400'}`} />
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}