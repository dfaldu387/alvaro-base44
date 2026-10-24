import React, { useMemo } from 'react';
import {
  CheckCircle2, ChevronRight, MapPin, Scissors, Clock,
  Car, Hourglass, UtensilsCrossed, Timer
} from 'lucide-react';
import { decimalToLabel } from '@/lib/timeUtils';

function fmtMins(mins) {
  if (!mins || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function idleLabel(mins) {
  if (mins >= 120) return 'Major Gap — Fill This';
  if (mins >= 45) return 'Large Gap';
  return 'Available to fill';
}

/* ── Dot variants ─────────────────────────────────────── */
function TimelineDot({ type, isCompleted, isCurrent, stopNumber }) {
  if (type === 'appointment') {
    if (isCompleted) {
      return (
        <div className="w-7 h-7 rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
        </div>
      );
    }
    if (isCurrent) {
      return (
        <div className="w-7 h-7 rounded-full border-2 border-primary bg-background flex items-center justify-center shrink-0 shadow-[0_0_0_3px_rgba(147,51,234,0.2)]">
          <div className="w-2.5 h-2.5 rounded-full bg-primary" />
        </div>
      );
    }
    return (
      <div className="w-7 h-7 rounded-full border-2 border-border bg-card flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold text-muted-foreground">{stopNumber}</span>
      </div>
    );
  }
  if (type === 'buffer') {
    return (
      <div className="w-6 h-6 rounded-full border border-border bg-card flex items-center justify-center shrink-0">
        <Clock className="w-3 h-3 text-muted-foreground" />
      </div>
    );
  }
  if (type === 'drive') {
    return (
      <div className="w-6 h-6 rounded-full border border-border bg-card flex items-center justify-center shrink-0">
        <Car className="w-3 h-3 text-muted-foreground" />
      </div>
    );
  }
  if (type === 'idle') {
    return (
      <div className="w-6 h-6 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center shrink-0">
        <Hourglass className="w-3 h-3 text-amber-400" />
      </div>
    );
  }
  if (type === 'lunch' || type === 'break') {
    return (
      <div className="w-6 h-6 rounded-full border border-green-500/40 bg-green-500/10 flex items-center justify-center shrink-0">
        <UtensilsCrossed className="w-3 h-3 text-green-400" />
      </div>
    );
  }
  return null;
}

/* ── Card variants ─────────────────────────────────────── */
// "Running-late text sent · 2:15pm–2:30pm" so nobody sends a second apology by hand.
function lateNote(info) {
  const window = info.window_label ? ` · ${info.window_label}` : '';
  if (info.status === 'sent') return { text: `Running-late text sent${window}`, cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' };
  if (info.status === 'suppressed' || info.status === 'dead_letter' || info.status === 'failed') {
    return { text: `Running-late text not sent${info.reason ? `: ${info.reason}` : ''}`, cls: 'text-muted-foreground bg-muted/60 border-border' };
  }
  return { text: `Running-late text queued${window}`, cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' };
}

function AppointmentCard({ block, isCompleted, isCurrent, currentDriveInfo, cardRef, lateInfo, isExpanded, onToggle, details }) {
  const { stop } = block;

  const leaveBy = React.useMemo(() => {
    const driveMins = currentDriveInfo?.state === 'ok' ? currentDriveInfo.mins : 15;
    const leaveDecimal = stop.apptEnd - driveMins / 60;
    return decimalToLabel(leaveDecimal);
  }, [stop.apptEnd, currentDriveInfo]);

  const serviceCounts = (stop.services || []).reduce((acc, s) => {
    acc[s] = (acc[s] || 0) + 1; return acc;
  }, {});
  const serviceDisplay = Object.entries(serviceCounts)
    .map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
    .join(' + ');

  return (
    <div
      ref={cardRef}
      className={`flex-1 rounded-2xl border transition-all duration-300 ${
        isCompleted
          ? 'bg-card/50 border-border/60 opacity-75'
          : isCurrent || isExpanded
          ? 'bg-primary/[0.06] border-primary'
          : 'bg-card border-border'
      } ${isExpanded ? 'ring-1 ring-primary/40 shadow-[0_0_0_3px_rgba(147,51,234,0.08)]' : ''}`}
    >
      {/* A div rather than a button: the summary holds block content, and iOS Safari
          mis-renders a button with block children. Keyboard opening is kept by hand. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(); }
        }}
        aria-expanded={isExpanded}
        className="w-full cursor-pointer p-3.5 text-left"
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex-1 min-w-0">
            {isCurrent && (
              <p className="text-[9px] font-bold text-primary tracking-[0.16em] uppercase mb-1">Current Stop</p>
            )}
            <p className={`text-[15px] font-bold leading-snug ${isCompleted ? 'text-muted-foreground' : 'text-foreground'}`}>
              {stop.clientName}
            </p>
            <p className="mt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {decimalToLabel(stop.apptStart)}–{decimalToLabel(stop.apptEnd)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {isCompleted && (
              <span className="text-[10px] font-semibold text-green-400 bg-green-500/15 border border-green-500/30 px-2 py-0.5 rounded-full">Completed</span>
            )}
            {isCurrent && (
              <span className="text-[10px] font-semibold text-primary bg-primary/15 border border-primary/30 px-2 py-0.5 rounded-full">Current</span>
            )}
            {!isCompleted && !isCurrent && (
              <span className="text-[10px] font-semibold text-muted-foreground bg-muted/60 border border-border px-2 py-0.5 rounded-full">Upcoming</span>
            )}
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
          </div>
        </div>

        {/* Address */}
        {stop.address && (
          <div className="flex items-center gap-1.5 mb-1">
            <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">{stop.address}</span>
          </div>
        )}

        {/* Service + price */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Scissors className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              {serviceDisplay || 'Haircut'} · {stop.duration} min
            </span>
          </div>
          {stop.price > 0 && (
            <span className={`text-sm font-bold ${isCompleted ? 'text-muted-foreground' : 'text-primary'}`}>
              ${stop.price}
            </span>
          )}
        </div>

        {lateInfo && (() => {
          const note = lateNote(lateInfo);
          return <p className={`mt-2 inline-block text-[10px] font-semibold border px-2 py-0.5 rounded-full ${note.cls}`}>{note.text}</p>;
        })()}

        {/* Leave by (current only) */}
        {isCurrent && (
          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-primary/20">
            <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground">Leave by {leaveBy}</span>
          </div>
        )}
      </div>

      {/* Opened: the whole appointment, in place. Its time and the route are untouched. */}
      {isExpanded && details && (
        <div className="cal-pop border-t border-primary/20 px-3.5 pb-3.5 pt-3">
          {details}
        </div>
      )}
    </div>
  );
}

function SlimCard({ children, className = '' }) {
  return (
    <div className={`flex-1 rounded-xl border border-border bg-card px-3 py-2 ${className}`}>
      {children}
    </div>
  );
}

/* ── Main export ───────────────────────────────────────── */
export default function TimelineBlock({
  block,
  isCompleted,
  isCurrent,
  isLast,
  stopNumber,
  currentDriveInfo,
  currentCardRef,
  showTimestamp,
  lateInfo,
  isExpanded,
  onToggle,
  details,
}) {
  const isLargeBlock = block.type === 'appointment';
  const dotSize = isLargeBlock ? 'w-7' : 'w-6';

  return (
    <div className="flex items-start">
      {/* Timestamp column */}
      <div className="w-14 shrink-0 text-right pr-2 pt-2.5">
        {showTimestamp && (
          <span className="text-[11px] font-medium text-muted-foreground leading-none">
            {decimalToLabel(block.startDecimal)}
          </span>
        )}
      </div>

      {/* Timeline spine */}
      <div className="flex flex-col items-center shrink-0 mr-2.5" style={{ width: 28 }}>
        <TimelineDot
          type={block.type}
          isCompleted={isCompleted}
          isCurrent={isCurrent}
          stopNumber={stopNumber}
        />
        {!isLast && (
          <div className="w-px flex-1 bg-border mt-1" style={{ minHeight: isLargeBlock ? 40 : 16 }} />
        )}
      </div>

      {/* Card area */}
      <div className="flex-1 pb-2">
        {block.type === 'appointment' && (
          <AppointmentCard
            block={block}
            isCompleted={isCompleted}
            isCurrent={isCurrent}
            currentDriveInfo={currentDriveInfo}
            cardRef={isCurrent ? currentCardRef : null}
            lateInfo={lateInfo}
            isExpanded={isExpanded}
            onToggle={onToggle}
            details={details}
          />
        )}

        {block.type === 'buffer' && (
          <SlimCard>
            <p className="text-[12px] font-semibold text-muted-foreground">Buffer</p>
            <p className="text-[11px] text-muted-foreground/70">{fmtMins(block.durationMins)} · Clean setup + pack down</p>
          </SlimCard>
        )}

        {block.type === 'drive' && (
          <SlimCard>
            <p className="text-[12px] font-semibold text-muted-foreground">
              {block.driveState === 'loading' ? 'Drive' : 'Drive'}
            </p>
            {block.driveState === 'loading' && (
              <p className="text-[11px] text-muted-foreground/60 italic">Calculating drive time…</p>
            )}
            {block.driveState === 'missing_address' && (
              <p className="text-[11px] text-muted-foreground/60">Address unavailable</p>
            )}
            {block.driveState === 'ok' && (
              <p className={`text-[11px] ${block.isConflict ? 'text-red-400' : 'text-muted-foreground/70'}`}>
                {block.durationMins} min
                {block.km ? ` · ${block.km} km` : ''}
                {block.suburb ? ` · ${block.suburb}` : ''}
              </p>
            )}
          </SlimCard>
        )}

        {block.type === 'idle' && (
          <div className="flex-1 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2">
            <p className="text-[12px] font-semibold text-amber-400">
              Idle Time
            </p>
            <p className="text-[11px] text-amber-300/70">{fmtMins(block.durationMins)} · {idleLabel(block.durationMins)}</p>
          </div>
        )}

        {(block.type === 'lunch' || block.type === 'break') && (
          <div className="flex-1 rounded-xl border border-green-500/25 bg-green-500/8 px-3 py-2">
            <p className="text-[12px] font-semibold text-green-400">
              {block.type === 'lunch' ? 'Lunch Break' : 'Break'}
            </p>
            <p className="text-[11px] text-green-300/70">{fmtMins(block.durationMins)} · Planned break</p>
          </div>
        )}
      </div>
    </div>
  );
}