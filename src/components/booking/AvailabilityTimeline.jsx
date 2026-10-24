import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Clock, Equal } from 'lucide-react';
import { decimalToLabel } from '@/lib/demandUtils';

const HOUR_START = 9;
const DEFAULT_MAX_END = 18;     // 6pm — normal availability cannot extend past after-hours start
const PX_PER_HOUR = 48;
const SNAP_DEC = 0.5;            // 30-min snap

function decToPx(dec) { return (dec - HOUR_START) * PX_PER_HOUR; }
function pxToDec(px) { return px / PX_PER_HOUR + HOUR_START; }
function snapDec(d) { return Math.round(d / SNAP_DEC) * SNAP_DEC; }

function fmtDuration(hours) {
  if (hours <= 0) return '0 mins';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h} hr ${m} mins`;
  if (h > 0) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} mins`;
}

const FLEX_TONES = {
  red:     { ring: 'border-red-500/25 bg-red-500/6',         dot: 'bg-red-500' },
  amber:   { ring: 'border-amber-500/25 bg-amber-500/6',     dot: 'bg-amber-500' },
  yellow:  { ring: 'border-yellow-500/25 bg-yellow-500/6',   dot: 'bg-yellow-500' },
  green:   { ring: 'border-green-500/20 bg-green-500/6',     dot: 'bg-green-500' },
  emerald: { ring: 'border-emerald-500/20 bg-emerald-500/6', dot: 'bg-emerald-500' },
  blue:    { ring: 'border-blue-500/25 bg-blue-500/6',       dot: 'bg-blue-500' },
};

function getFlexibility(hours) {
  const mins = hours * 60;
  if (mins < 60)   return { label: 'Minimum availability is 1 hour', body: 'Please select at least a 1-hour window so we have enough flexibility to organise your appointment.', tone: 'red' };
  if (mins < 120)  return { label: 'Limited flexibility', body: 'A wider window gives us more room to organise your appointment.', tone: 'amber' };
  if (mins <= 180) return { label: 'Recommended', body: 'This is the recommended availability range for efficient scheduling.', tone: 'green' };
  if (mins <= 300) return { label: 'Very flexible', body: 'Plenty of flexibility for your barber.', tone: 'emerald' };
  return { label: 'Wide availability', body: "You've selected more than 5 hours. Only continue if you'll genuinely be available throughout this entire window.", tone: 'blue' };
}

function buildBusyBlocks(busyAppts) {
  return busyAppts
    .map(a => ({
      start: a.startDecimal ?? a.apptStart,
      end: a.endDecimal ?? (a.apptEnd || a.apptStart + (a.duration_mins || 30) / 60),
    }))
    .filter(b => b.start != null && b.end != null && b.end > b.start)
    .sort((a, b) => a.start - b.start);
}

export default function AvailabilityTimeline({
  value,
  onChange,
  busyAppts = [],
  minWindowMins = 30,
  durationMins = 0,
  maxEnd = DEFAULT_MAX_END,
}) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);

  // The selection must be read FIRST — `renderEndLimit` below is derived from
  // `selEnd`. Declaring it afterwards made every render of the timeline throw
  // "Cannot access 'selEnd' before initialization" and blanked step 3.
  const [selStart, selEnd] = value;

  const endLimit = maxEnd;
  const renderEndLimit = Math.max(endLimit, selEnd);
  const minWindowHours = 0.5;
  const busyBlocks = useMemo(() => buildBusyBlocks(busyAppts), [busyAppts]);

  const windowHours = Math.max(0, selEnd - selStart);

  const flex = getFlexibility(windowHours);
  const flexTone = FLEX_TONES[flex.tone];

  const hours = [];
  for (let h = HOUR_START; h <= renderEndLimit; h++) hours.push(h);
  const halfHours = [];
  for (let h = HOUR_START; h < renderEndLimit; h++) halfHours.push(h + 0.5);

  const totalHeight = (renderEndLimit - HOUR_START) * PX_PER_HOUR;

  const onPointerDown = useCallback((e, thumb) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { thumb, startClientY: e.clientY, lastSnapped: thumb === 'top' ? selStart : selEnd };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
  }, [selStart, selEnd]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const rawDec = pxToDec(e.clientY - rect.top);
      const snapped = Math.max(HOUR_START, Math.min(endLimit, snapDec(rawDec)));
      const d = dragRef.current;
      if (d.thumb === 'top') {
        const newStart = Math.min(snapped, selEnd - minWindowHours);
        if (newStart !== selStart) {
          if (newStart !== d.lastSnapped) { navigator.vibrate?.(8); d.lastSnapped = newStart; }
          onChange([newStart, selEnd]);
        }
      } else {
        // Bottom handle is hard-clamped to the after-hours start time (endLimit)
        const newEnd = Math.max(Math.min(snapped, endLimit), selStart + minWindowHours);
        if (newEnd !== selEnd) {
          if (newEnd !== d.lastSnapped) { navigator.vibrate?.(8); d.lastSnapped = newEnd; }
          onChange([selStart, newEnd]);
        }
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [selStart, selEnd, onChange, minWindowHours, endLimit]);

  const topPx = decToPx(selStart);
  const bottomPx = decToPx(selEnd);
  const selHeight = Math.max(0, bottomPx - topPx);

  return (
    <div className="space-y-3">
      {/* ── Timeline ── */}
      <div className="relative flex" style={{ height: totalHeight + 32, paddingTop: 16, paddingBottom: 16 }}>
        {/* Time labels */}
        <div className="w-14 shrink-0 relative">
          {hours.map(h => (
            <div key={h} className="absolute left-0 -translate-y-1/2 text-[12px] font-medium text-[#888888]" style={{ top: decToPx(h) }}>
              {decimalToLabel(h)}
            </div>
          ))}
        </div>

        {/* Track + handles wrapper — handles are siblings of the track so they
            straddle the top/bottom border cleanly (not clipped by overflow-hidden) */}
        <div className="relative flex-1">
        {/* Track */}
        <div ref={trackRef} className="absolute inset-0 rounded-3xl overflow-hidden border border-[#2a2a2e] bg-[#0e0e11]">
          {/* Hour gridlines */}
          {hours.slice(0, -1).map(h => (
            <div key={`h${h}`} className="absolute left-0 right-0 border-t border-white/[0.05]" style={{ top: decToPx(h) }} />
          ))}
          {/* Half-hour dividers */}
          {halfHours.map(hd => (
            <div key={`hh${hd}`} className="absolute left-0 right-0" style={{ top: decToPx(hd), borderTop: '1px dashed rgba(255,255,255,0.045)' }} />
          ))}

          {/* Reserved blocks — bright neon purple, render above the selection so
              they're clearly visible inside the customer's availability window.
              Overlaps are allowed; the barber schedules around them. */}
          {busyBlocks.map((b, i) => {
            const top = decToPx(Math.max(b.start, HOUR_START));
            const h = decToPx(Math.min(b.end, endLimit)) - decToPx(Math.max(b.start, HOUR_START));
            if (h <= 0) return null;
            return (
              <div
                key={i}
                className="absolute left-0 right-0 z-[25] pointer-events-none"
                style={{
                  top,
                  height: h,
                  background: 'rgba(139,61,255,0.20)',
                  backgroundImage: 'repeating-linear-gradient(45deg, rgba(139,61,255,0.42) 0px, rgba(139,61,255,0.42) 4px, transparent 4px, transparent 9px)',
                  border: '1.5px solid rgba(139,61,255,0.85)',
                  boxShadow: '0 0 14px rgba(139,61,255,0.45)',
                }}
              >
                <span className="absolute top-1.5 left-3 text-[9px] font-bold text-primary uppercase tracking-wider">Reserved</span>
              </div>
            );
          })}

          {/* Selection: hero translucent purple block with neon glow + border */}
          <div
            className="absolute left-1.5 right-1.5 z-20 rounded-2xl flex flex-col items-center justify-center pointer-events-none"
            style={{
              top: topPx,
              height: selHeight,
              background: 'rgba(139,61,255,0.16)',
              border: '1.5px solid rgba(139,61,255,0.7)',
              boxShadow: '0 0 30px rgba(139,61,255,0.35), 0 0 60px rgba(139,61,255,0.2) inset',
            }}
          >
            {selHeight >= 70 && (
              <div className="text-center leading-tight">
                <p className="text-[9px] font-bold text-primary/90 tracking-[0.15em] uppercase mb-1">You're Available</p>
                <p className="text-[17px] font-bold text-white tracking-tight">{decimalToLabel(selStart)} – {decimalToLabel(selEnd)}</p>
                <p className="text-[12px] font-semibold text-primary/90 mt-0.5">{fmtDuration(windowHours)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Top handle + floating time tag (outside overflow-hidden so it straddles the border) */}
        <div
          onPointerDown={(e) => onPointerDown(e, 'top')}
          className="absolute left-1/2 z-30 cursor-grab active:cursor-grabbing touch-none"
          style={{ top: topPx, transform: 'translate(-50%, -50%)' }}
        >
          <div className="w-8 h-8 rounded-full bg-white border-[3px] border-primary shadow-[0_0_16px_rgba(139,61,255,0.65)] flex items-center justify-center">
            <Equal className="w-3.5 h-3.5 text-primary" />
          </div>
        </div>
        <div
          className="absolute z-40 px-2.5 py-1 rounded-full bg-[#141418] border border-primary/70 whitespace-nowrap pointer-events-none"
          style={{ top: topPx, transform: 'translateY(-50%)', left: 'calc(50% + 24px)' }}
        >
          <span className="text-[11px] font-bold text-white tracking-tight">{decimalToLabel(selStart)}</span>
        </div>

        {/* Bottom handle + floating time tag */}
        <div
          onPointerDown={(e) => onPointerDown(e, 'bottom')}
          className="absolute left-1/2 z-30 cursor-grab active:cursor-grabbing touch-none"
          style={{ top: bottomPx, transform: 'translate(-50%, -50%)' }}
        >
          <div className="w-8 h-8 rounded-full bg-white border-[3px] border-primary shadow-[0_0_16px_rgba(139,61,255,0.65)] flex items-center justify-center">
            <Equal className="w-3.5 h-3.5 text-primary" />
          </div>
        </div>
        <div
          className="absolute z-40 px-2.5 py-1 rounded-full bg-[#141418] border border-primary/70 whitespace-nowrap pointer-events-none"
          style={{ top: bottomPx, transform: 'translateY(-50%)', left: 'calc(50% + 24px)' }}
        >
          <span className="text-[11px] font-bold text-white tracking-tight">{decimalToLabel(selEnd)}</span>
        </div>
        </div>
      </div>

      {/* ── Reserved helper text ── */}
      {busyBlocks.length > 0 && (
        <p className="text-[11px] text-[#888888] leading-relaxed px-1">
          You don't need to avoid reserved appointments. Select the full time you're available and we'll organise your appointment within that window.
        </p>
      )}

      {/* ── Legend ── */}
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-2 text-[11px] text-[#888888]">
          <span className="w-3 h-3 rounded bg-primary/30 border border-primary/50" /> Your availability
        </span>
        <span className="flex items-center gap-2 text-[11px] text-[#888888]">
          <span
            className="w-3 h-3 rounded border border-primary/85"
            style={{ background: 'rgba(139,61,255,0.20)', backgroundImage: 'repeating-linear-gradient(45deg, rgba(139,61,255,0.42) 0px, rgba(139,61,255,0.42) 2px, transparent 2px, transparent 4px)' }}
          /> Reserved
        </span>
      </div>

      {/* ── Bottom summary card ── */}
      <div className="rounded-2xl border border-[#1e1e26] bg-[#141418] overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-[#2a2a2e]">
          <div className="px-3.5 py-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/12 border border-primary/30 flex items-center justify-center shrink-0">
              <Clock className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="leading-none min-w-0">
              <p className="text-[8px] font-semibold text-[#888888] tracking-[0.1em] uppercase mb-1">Selected Availability</p>
              <p className="text-[14px] font-bold text-white tracking-tight truncate">{decimalToLabel(selStart)}–{decimalToLabel(selEnd)}</p>
              <p className="text-[11px] font-semibold text-primary mt-0.5">{fmtDuration(windowHours)}</p>
            </div>
          </div>
          <div className="px-3.5 py-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/12 border border-primary/30 flex items-center justify-center shrink-0">
              <Clock className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="leading-none min-w-0">
              <p className="text-[8px] font-semibold text-[#888888] tracking-[0.1em] uppercase mb-1">Estimated Duration</p>
              <p className="text-[14px] font-bold text-white">{durationMins} mins</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Flexibility indicator ── */}
      <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${flexTone.ring}`}>
        <div className={`w-2 h-2 rounded-full ${flexTone.dot} shrink-0 mt-1.5`} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-white leading-tight">{flex.label}</p>
          <p className="text-[12px] text-[#888888] leading-relaxed mt-0.5">{flex.body}</p>
        </div>
      </div>
    </div>
  );
}