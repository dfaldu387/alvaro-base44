import React, { useRef, useCallback, useState, useEffect } from 'react';
import { decimalToLabel, snapDecimal, snapTo5 } from '@/lib/timeUtils';
import { getOperatingBounds, isDayOpen } from '@/lib/businessHoursUtils';
import AppointmentBlockContent from '@/components/schedule/AppointmentBlockContent';
import BlockTimeCard from '@/components/schedule/BlockTimeCard';
import { appointmentMenuItems } from '@/components/schedule/appointmentMenu';
import CalendarGapLayer from '@/components/schedule/CalendarGapLayer';
import useGridRangeSelect from '@/hooks/useGridRangeSelect';

/** 120px per hour: a 30-minute booking is a fully readable card and a drive leg has room. */
const PX_PER_HOUR = 120;
const HOLD_MS = 400;

const STATUS_BLOCK_BG = {
  draft:            'bg-violet-50 text-violet-700 border border-violet-200',
  scheduled:        'bg-indigo-50 text-indigo-800 border border-indigo-200',
  completed:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelled:        'bg-zinc-100 text-zinc-500 border border-zinc-200',
  no_show:          'bg-red-50 text-red-700 border border-red-200',
  rescheduled:      'bg-amber-50 text-amber-700 border border-amber-200',
  blocked:          'bg-zinc-100 text-zinc-500 border border-zinc-200',
  planned:          'bg-violet-50 text-violet-700 border border-violet-200',
  window_confirmed: 'bg-indigo-50 text-indigo-800 border border-indigo-200',
  waiting:          'bg-amber-50 text-amber-700 border border-amber-200',
  client_confirmed: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

export default function DayTimeline({
  day, appointments, businessHours, onOpenDetail, onUpdateAppointment, onRemove,
  onEmptyHold, onEmptyRange, onToggleFavourite, legs = null,
  onSetScheduleStatus, onEditBlock, onDeleteBlock, onBlockCommit,
  // The live clock only belongs on today, and "Today" scrolls the timeline to it.
  isToday = false, scrollToNowSignal = 0, savingIds = null,
}) {
  const scrollRef = useRef(null);
  const plannerRef = useRef(null);
  const holdTimerRef = useRef(null);
  const emptyHoldTimerRef = useRef(null);
  const dragStateRef = useRef(null);
  const touchIdRef = useRef(null);
  const [dragApptId, setDragApptId] = useState(null);
  // Re-read every minute: the "now" line drifts down the day instead of stepping
  // whenever anything else re-renders.
  const [nowMinutes, setNowMinutes] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const dayBounds = getOperatingBounds(businessHours, day);
  const closed = !isDayOpen(businessHours, day);
  // Grid range: operating hours with a 1-hour buffer, or default 7–21 for closed days
  const HOUR_START = dayBounds ? Math.max(0, Math.floor(dayBounds.start) - 1) : 7;
  const HOUR_END = dayBounds ? Math.min(24, Math.ceil(dayBounds.end) + 1) : 21;

  // Half-hour steps, up to and including the closing hour: the timeline is read in
  // 30-minute increments, so every half hour gets its own rule and label.
  const ticks = Array.from({ length: (HOUR_END - HOUR_START) * 2 + 1 }, (_, i) => HOUR_START + i / 2);
  const totalHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;

  const decimalToPx = (dec) => (dec - HOUR_START) * PX_PER_HOUR;
  const pxToDecimal = (px) => px / PX_PER_HOUR + HOUR_START;
  const nowDecimal = nowMinutes / 60;

  // "Today" scrolls to the live time (or to the morning on a day that is not today).
  useEffect(() => {
    if (!scrollToNowSignal || !scrollRef.current) return;
    const target = isToday ? nowDecimal : Math.max(HOUR_START, 8);
    scrollRef.current.scrollTo({ top: Math.max(0, decimalToPx(target) - 120), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToNowSignal]);

  // The customer's submitted availability window is only surfaced while their
  // provisional appointment is being dragged — it is never a calendar block.
  const draggedAppt = dragApptId ? appointments.find(a => a.id === dragApptId) : null;
  const draggedWindow = draggedAppt?.schedule_status === 'provisional' &&
    draggedAppt.windowStart != null && draggedAppt.windowEnd != null
    ? { start: draggedAppt.windowStart, end: draggedAppt.windowEnd }
    : null;

  useEffect(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (emptyHoldTimerRef.current) clearTimeout(emptyHoldTimerRef.current);
  }, []);

  // Click, or click and drag, on an empty part of the day. A click opens the form at
  // that time; a drag picks the range it covers and opens the form at its start. The
  // dragged length is only a preview — the service decides the real duration.
  const rangeSelect = useGridRangeSelect({
    pxPerHour: PX_PER_HOUR,
    hourStart: HOUR_START,
    hourEnd: HOUR_END,
    enabled: !dragApptId,
    onSelect: ({ start, end }) => {
      if (end != null) onEmptyRange?.(start, end);
      else onEmptyHold?.(start);
    },
  });

  const handleEmptyTouchStart = useCallback((e) => {
    if (!onEmptyHold || !plannerRef.current) return;
    const touch = e.touches[0];
    const startY = touch.clientY;
    const startX = touch.clientX;

    emptyHoldTimerRef.current = setTimeout(() => {
      if (!plannerRef.current) return;
      const rect = plannerRef.current.getBoundingClientRect();
      const rawDec = pxToDecimal(startY - rect.top);
      const snapped = snapDecimal(rawDec);
      if (navigator.vibrate) navigator.vibrate(30);
      onEmptyHold(snapped);
    }, 300);

    const cancelHold = () => {
      clearTimeout(emptyHoldTimerRef.current);
      document.removeEventListener('touchmove', onMoveCancel);
      document.removeEventListener('touchend', cancelHold);
    };
    const onMoveCancel = (ev) => {
      const t = ev.touches[0];
      if (Math.abs(t.clientY - startY) > 10 || Math.abs(t.clientX - startX) > 10) cancelHold();
    };
    document.addEventListener('touchmove', onMoveCancel, { passive: true });
    document.addEventListener('touchend', cancelHold, { once: true });
  }, [onEmptyHold, HOUR_START]);

  const cleanupDragState = useCallback(() => {
    dragStateRef.current = null;
    touchIdRef.current = null;
    setDragApptId(null);
    if (scrollRef.current) scrollRef.current.style.overflow = 'auto';
  }, []);

  // commitDrag: the drop is saved either way. Outside the client's preferred
  // availability it is flagged for their confirmation and they are texted; inside
  // it, any previous override flag is cleared and nothing else is asked of anyone.
  const commitDrag = useCallback((apptId, prevState, outside = false) => {
    const dragged = dragStateRef.current?.appt;
    const changes = {
      availability_override: outside,
      override_status: outside ? 'awaiting_confirmation' : 'none',
    };
    if (dragged && prevState && dragged.apptStart !== prevState.apptStart) {
      changes.apptStart = dragged.apptStart;
      changes.apptEnd = dragged.apptEnd;
      changes.bufferEnd = dragged.bufferEnd;
    }
    onUpdateAppointment(apptId, changes, true, prevState, {
      commit: true,
      override: outside,
      overrideReason: outside ? 'Placed outside preferred availability — confirmation requested' : null,
    });
    cleanupDragState();
  }, [onUpdateAppointment, cleanupDragState]);

  // Has this position left the window the client asked for?
  const isOutsideAvailability = useCallback((a) => {
    if (a.windowStart == null || a.windowEnd == null) return false;
    return a.apptStart < a.windowStart - 0.001 || a.apptEnd > a.windowEnd + 0.001;
  }, []);

  const handleTouchStart = useCallback((e, appt) => {
    if (appt.status === 'completed' || appt.status === 'cancelled') return;

    const touch = e.touches[0];
    const startY = touch.clientY;
    const startX = touch.clientX;
    touchIdRef.current = touch.identifier;

    let dragActivated = false;

    const onTouchMove = (ev) => {
      let t = null;
      for (let i = 0; i < ev.touches.length; i++) {
        if (ev.touches[i].identifier === touchIdRef.current) { t = ev.touches[i]; break; }
      }
      if (!t) return;
      if (!dragActivated) return;
      ev.preventDefault();
      if (!dragStateRef.current || !plannerRef.current) return;
      const r = plannerRef.current.getBoundingClientRect();
      const raw = pxToDecimal(t.clientY - r.top - dragStateRef.current.offsetY);
      // Moved in 5-minute steps, the same increment the scheduling engine uses.
      const snapped = snapTo5(raw);
      const { appt: a } = dragStateRef.current;
      const dur = a.apptEnd - a.apptStart;
      const bufDur = (a.bufferEnd || a.apptEnd) - a.apptEnd;
      const newStart = Math.max(HOUR_START, Math.min(HOUR_END - dur, snapped));
      onUpdateAppointment(a.id, { apptStart: newStart, apptEnd: newStart + dur, bufferEnd: newStart + dur + bufDur });
      dragStateRef.current.appt = { ...a, apptStart: newStart, apptEnd: newStart + dur, bufferEnd: newStart + dur + bufDur };
    };

    const onTouchEnd = (ev) => {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      if (dragActivated && dragStateRef.current) {
        const now = dragStateRef.current.appt;
        const moved = Math.abs(now.apptStart - dragStateRef.current.prevState.apptStart) > 1e-6;
        commitDrag(dragStateRef.current.apptId, dragStateRef.current.prevState, moved && isOutsideAvailability(now));
      } else if (!dragActivated) {
        onOpenDetail(appt);
      }
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);

    holdTimerRef.current = setTimeout(() => {
      if (!plannerRef.current) return;
      dragActivated = true;
      if (scrollRef.current) scrollRef.current.style.overflow = 'hidden';
      const rect = plannerRef.current.getBoundingClientRect();
      const offsetY = startY - rect.top - decimalToPx(appt.apptStart);
      dragStateRef.current = {
        apptId: appt.id,
        offsetY,
        prevState: { apptStart: appt.apptStart, apptEnd: appt.apptEnd, bufferEnd: appt.bufferEnd },
        appt,
      };
      setDragApptId(appt.id);
      if (navigator.vibrate) navigator.vibrate(30);
    }, HOLD_MS);
  }, [onUpdateAppointment, onOpenDetail, commitDrag, HOUR_START, HOUR_END]);

  const handleMouseDown = useCallback((e, appt) => {
    if (appt.status === 'completed' || appt.status === 'cancelled') return;
    e.stopPropagation();
    const startY = e.clientY;
    let dragActivated = false;

    const onMouseMove = (ev) => {
      if (!dragActivated) return;
      if (!dragStateRef.current || !plannerRef.current) return;
      const r = plannerRef.current.getBoundingClientRect();
      const raw = pxToDecimal(ev.clientY - r.top - dragStateRef.current.offsetY);
      const snapped = snapTo5(raw);
      const { appt: a } = dragStateRef.current;
      const dur = a.apptEnd - a.apptStart;
      const bufDur = (a.bufferEnd || a.apptEnd) - a.apptEnd;
      const newStart = Math.max(HOUR_START, Math.min(HOUR_END - dur, snapped));
      onUpdateAppointment(a.id, { apptStart: newStart, apptEnd: newStart + dur, bufferEnd: newStart + dur + bufDur });
      dragStateRef.current.appt = { ...a, apptStart: newStart, apptEnd: newStart + dur, bufferEnd: newStart + dur + bufDur };
    };

    const onMouseUp = () => {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (dragActivated && dragStateRef.current) {
        const now = dragStateRef.current.appt;
        const moved = Math.abs(now.apptStart - dragStateRef.current.prevState.apptStart) > 1e-6;
        commitDrag(dragStateRef.current.apptId, dragStateRef.current.prevState, moved && isOutsideAvailability(now));
      } else if (!dragActivated) {
        onOpenDetail(appt);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    holdTimerRef.current = setTimeout(() => {
      if (!plannerRef.current) return;
      dragActivated = true;
      const rect = plannerRef.current.getBoundingClientRect();
      const offsetY = startY - rect.top - decimalToPx(appt.apptStart);
      dragStateRef.current = {
        apptId: appt.id,
        offsetY,
        prevState: { apptStart: appt.apptStart, apptEnd: appt.apptEnd, bufferEnd: appt.bufferEnd },
        appt,
      };
      setDragApptId(appt.id);
    }, HOLD_MS);
  }, [onUpdateAppointment, onOpenDetail, commitDrag, HOUR_START, HOUR_END]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-white [scrollbar-color:theme(colors.zinc.300)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar]:h-[6px] [&::-webkit-scrollbar]:w-[6px] [&::-webkit-scrollbar-track]:bg-transparent">
      <div
        ref={plannerRef}
        className="relative mx-4 my-2"
        style={{ height: totalHeight + 'px' }}
        onTouchStart={handleEmptyTouchStart}
        onPointerDown={(e) => rangeSelect.onPointerDown(e, 'day')}
      >
        {/* Grid rules — the timeline is read in 30-minute increments: full hours
            solid and darker, half hours light and dashed. */}
        {ticks.map((t, ti) => {
          const onHour = Number.isInteger(t);
          return (
            <div key={t} className="pointer-events-none absolute left-0 right-0 flex items-center" style={{ top: (t - HOUR_START) * PX_PER_HOUR + 'px' }}>
              {/* items-center puts the label on its rule exactly. The first one
                  would be clipped by the top of the scroll area, so it sits just
                  below its rule instead. */}
              <span
                className={`w-16 shrink-0 select-none whitespace-nowrap pr-2.5 text-right leading-none tabular-nums ${onHour ? 'text-[10px] font-semibold text-zinc-500' : 'text-[9px] font-medium text-zinc-400'} ${ti === 0 ? 'self-start pt-0.5' : ''}`}
              >
                {decimalToLabel(t)}
              </span>
              {/* Full hours carry the eye down the timeline; the half hour is only a
                  step, so it stays lighter and dotted. */}
              <div className={`flex-1 border-t ${onHour ? 'border-zinc-300' : 'border-dotted border-zinc-200/60'}`} />
            </div>
          );
        })}

        {/* The live clock: a time chip, a quiet pulsing dot and a fine line, eased over a
            minute so it drifts down the timeline instead of stepping. */}
        {isToday && nowDecimal >= HOUR_START && nowDecimal <= HOUR_END && (
          <div
            className="pointer-events-none absolute z-30 flex items-center transition-[top] duration-[60000ms] ease-linear"
            style={{ left: '52px', right: 0, top: decimalToPx(nowDecimal) + 'px' }}
          >
            <span className="-ml-1 shrink-0 rounded bg-red-500 px-1 py-[1px] text-[9px] font-bold leading-none tabular-nums text-white">
              {decimalToLabel(nowDecimal)}
            </span>
            <span className="relative -ml-1 flex h-2 w-2 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-400 opacity-50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
            </span>
            <span className="h-px flex-1 bg-red-500/60" />
          </div>
        )}

        {/* Non-operating hours dimming */}
        {closed ? (
          <div className="absolute pointer-events-none bg-zinc-50" style={{ left: '52px', right: 0, top: 0, bottom: 0, backgroundImage: 'repeating-linear-gradient(45deg, rgba(63,63,70,0.05), rgba(63,63,70,0.05) 6px, transparent 6px, transparent 12px)' }}>
            <div className="flex items-center justify-center h-full">
              <span className="text-sm text-zinc-500 font-semibold bg-white/80 px-4 py-2 rounded-lg">Closed — {day}</span>
            </div>
          </div>
        ) : dayBounds && (
          <>
            {dayBounds.start > HOUR_START && (
              <div className="absolute pointer-events-none bg-zinc-50/70" style={{ left: '52px', right: 0, top: 0, height: (dayBounds.start - HOUR_START) * PX_PER_HOUR, backgroundImage: 'repeating-linear-gradient(45deg, rgba(63,63,70,0.05), rgba(63,63,70,0.05) 6px, transparent 6px, transparent 12px)' }} />
            )}
            {dayBounds.end < HOUR_END && (
              <div className="absolute pointer-events-none bg-zinc-50/70" style={{ left: '52px', right: 0, top: (dayBounds.end - HOUR_START) * PX_PER_HOUR, bottom: 0, backgroundImage: 'repeating-linear-gradient(45deg, rgba(63,63,70,0.05), rgba(63,63,70,0.05) 6px, transparent 6px, transparent 12px)' }} />
            )}
          </>
        )}

        {/* Customer availability window — visible only while dragging this customer's
            provisional appointment. Sits beneath the card so it can never cover it. */}
        {draggedWindow && (
          <div
            className="absolute pointer-events-none z-0"
            style={{
              left: '56px', right: 0,
              top: decimalToPx(draggedWindow.start) + 'px',
              height: (draggedWindow.end - draggedWindow.start) * PX_PER_HOUR + 'px',
            }}
          >
            <div className="absolute inset-0 bg-[#7c3aed]/[0.08] border-y border-dashed border-[#8b5cf6]/40" />
            <span className="absolute top-1 left-2 text-[9px] font-semibold uppercase tracking-wide text-violet-600/70">
              Availability Window · {decimalToLabel(draggedWindow.start)}–{decimalToLabel(draggedWindow.end)}
            </span>
          </div>
        )}

        {/* Appointments */}
        {appointments.map(appt => {
          // Blocked time is its own kind of block: same interaction, distinct look.
          if (appt.isBlock) {
            return (
              <BlockTimeCard
                key={appt.id}
                appt={appt}
                topPx={decimalToPx(appt.apptStart)}
                heightPx={Math.max((appt.apptEnd - appt.apptStart) * PX_PER_HOUR, 36)}
                hourStart={HOUR_START}
                hourEnd={HOUR_END}
                insetClass="left-14 right-0"
                onCommit={onBlockCommit}
                onEdit={onEditBlock}
                onDelete={onDeleteBlock}
              />
            );
          }
          const isDragging = dragApptId === appt.id;
          const topPx = decimalToPx(appt.apptStart);
          const heightPx = Math.max((appt.apptEnd - appt.apptStart) * PX_PER_HOUR, 44);
          const isCancelled = appt.status === 'cancelled';
          const isCompleted = appt.status === 'completed';
          const saving = savingIds?.has?.(appt.id) === true;

          return (
            <React.Fragment key={appt.id}>

              {/* A save in flight is said on the card, so the timeline is never blocked
                  while the server catches up. */}
              {saving && !isDragging && (
                <div
                  className="pointer-events-none absolute z-[47] inline-flex rounded bg-white/95 px-1.5 py-0.5 text-[9px] font-bold leading-none text-indigo-600 shadow-sm ring-1 ring-indigo-100"
                  style={{ left: '56px', top: topPx - 16 }}
                >
                  Saving…
                </div>
              )}

              <div
                data-appt
                className={`absolute rounded-lg flex overflow-hidden select-none bg-white ${
                  isDragging ? 'z-20 scale-[1.02] cal-drag' : 'z-10 cal-move'
                } ${isCancelled ? 'opacity-70' : ''} ${
                  !isDragging && !isCancelled && !isCompleted ? 'hover:z-20 hover:-translate-y-px hover:shadow-md' : ''
                }`}
                style={{
                  left: '56px', right: '0',
                  top: topPx + 'px', height: heightPx + 'px',
                  // Light neon purple, the same card as the week view: a soft violet fill
                  // with a violet edge, and no colour telling services apart.
                  // The same pale purple plan as the week view: soft fill, one quiet
                  // border, and a shadow that only lifts while it is being dragged.
                  background: isCancelled ? '#fafafa' : '#f8f6ff',
                  border: isCancelled ? '1px dashed #d4d4d8' : '1px solid #e3ddfb',
                  boxShadow: isDragging ? '0 4px 12px rgba(76,29,149,0.14)' : '0 1px 2px rgba(88,28,135,0.06)',
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  cursor: isDragging ? 'grabbing' : isCompleted ? 'default' : 'pointer',
                }}
                onMouseDown={(e) => handleMouseDown(e, appt)}
                onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, appt); }}
              >
                <AppointmentBlockContent
                  appt={appt}
                  startLabel={decimalToLabel(appt.apptStart)}
                  heightPx={heightPx}
                  nameMode="compact"
                  showMenu
                  onToggleFavourite={onToggleFavourite}
                  menuItems={appointmentMenuItems({ appt, onOpen: onOpenDetail, onSetScheduleStatus })}
                />
              </div>
            </React.Fragment>
          );
        })}

        {/* The exact time occupied by buffers, driving and waiting, with reasons. */}
        {!dragApptId && <CalendarGapLayer appointments={appointments} legs={legs}
          bounds={dayBounds} hourStart={HOUR_START} pxPerHour={PX_PER_HOUR} insetClass="left-14 right-0" />}

        {/* Empty state */}
        {appointments.length === 0 && !closed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none" style={{ left: '52px' }}>
            <p className="text-sm text-zinc-600">{dayBounds ? 'No appointments for this day' : 'No appointments'}</p>
            <p className="text-xs text-zinc-700">Click any time slot to create a booking.</p>
          </div>
        )}

        {/* The range being dragged: translucent purple, from where the drag started to
            where the pointer is now. */}
        {rangeSelect.preview && (
          <div
            className="pointer-events-none absolute z-[45] rounded-lg border-2 border-dashed border-violet-400 bg-violet-500/15 px-2 py-1"
            style={{
              left: '56px',
              right: 0,
              top: `${decimalToPx(rangeSelect.preview.start)}px`,
              height: Math.max((rangeSelect.preview.end - rangeSelect.preview.start) * PX_PER_HOUR, 20),
            }}
          >
            <span className="whitespace-nowrap text-[10px] font-bold text-violet-700">
              {decimalToLabel(rangeSelect.preview.start)} – {decimalToLabel(rangeSelect.preview.end)}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}