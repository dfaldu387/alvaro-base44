/**
 * WeekGrid — the light weekly planning board.
 *
 * Day headers, a time column, light neon purple appointment cards that can be
 * dragged freely, and — once the day has been connected as a whole, from the day
 * bar above — the drive legs its route stored, each drawn in the room between two
 * cards. There is deliberately no connect control between two appointments: the
 * day is connected in one action, never booking-to-booking.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { format, isSameDay } from 'date-fns';
import { decimalToLabel, snapTo5 } from '@/lib/timeUtils';
import { getOverallBounds, getOperatingBounds, isDayOpen } from '@/lib/businessHoursUtils';
import { overlaps } from '@/lib/appointmentUtils';
import { cn } from '@/lib/utils';
import { dateKey } from '@/lib/dateScope';
import { AlertCircle } from 'lucide-react';
import AppointmentBlockContent from '@/components/schedule/AppointmentBlockContent';
import BlockTimeCard from '@/components/schedule/BlockTimeCard';
import { appointmentMenuItems } from '@/components/schedule/appointmentMenu';
import CalendarGapLayer from '@/components/schedule/CalendarGapLayer';
import { parseAvailabilityWindow, latestValidStart } from '@/lib/availabilityWindow';
import { previewPlacement } from '@/lib/placementPreview';
import useGridRangeSelect from '@/hooks/useGridRangeSelect';

/** 120px per hour: a 30-minute booking is a fully readable card and a drive leg has room. */
const PX_PER_HOUR = 120;
/** How long a press is held before a card starts following the pointer. Short, so a
 *  drag feels direct, and long enough that an ordinary click still opens the card. */
const HOLD_MS = 200;
/** Cards keep a minimum rendered height, so a short service is still readable. */
const APPT_MIN_PX = 44;
const cardHeightPx = (appt) => Math.max((appt.apptEnd - appt.apptStart) * PX_PER_HOUR, APPT_MIN_PX);

/** Preview colours for a drop: green valid, amber override, red impossible. */
const DROP_TONE = {
  valid: 'border-emerald-500 bg-emerald-500/10 text-emerald-700',
  override: 'border-amber-500 bg-amber-500/15 text-amber-700',
  invalid: 'border-red-500 bg-red-500/10 text-red-700',
};

/**
 * Where a dragged request would land, and what the calendar thinks of it.
 *
 * The pointer's column and time are read here (this file owns the pixel scale);
 * whether that time is valid is decided by lib/placementPreview, and finally by the
 * backend on drop. Pure: it reads a geometry snapshot and returns a plain object.
 */
function computeDropHover(geom, placement, rect, clientY) {
  const req = placement?.request || {};
  const idx = geom.selectedDate ? geom.days.findIndex(d => isSameDay(d, geom.selectedDate)) : -1;
  if (idx < 0 || !geom.dayDates[idx]) return null;
  const dayName = geom.dayNames[idx];
  const dur = (Number(req.duration_mins) || 30) / 60;
  const raw = (clientY - rect.top) / PX_PER_HOUR + geom.hourStart;
  const start = Math.max(geom.hourStart, Math.min(geom.hourEnd - dur, snapTo5(raw)));
  const win = parseAvailabilityWindow(req.availability_window);
  const preview = previewPlacement({
    startDecimal: start,
    durationMins: req.duration_mins,
    bufferMins: placement.bufferMins,
    window: win,
    dayAppts: (geom.apptsByDay || [])[idx] || [],
    dayBlocks: (geom.blocksByDay || [])[idx] || [],
    bounds: getOperatingBounds(geom.businessHours, dayName),
    closed: !isDayOpen(geom.businessHours, dayName),
  });
  return {
    index: idx, dateKey: geom.dayDates[idx], dayName,
    startDecimal: start, state: preview.state, reason: preview.reason,
    window: win, durationMins: Number(req.duration_mins) || 30,
  };
}

export default function WeekGrid({
  days, appointments, businessHours, onOpenDetail, onEmptyClick,
  onUpdateAppointment, previewAppointments = [], lockedIds, protectionSettings,
  selectedDate, onSelectDate, onToggleFavourite, onEmptyRange,
  selectedApptId = null,
  placement = null, onPlacementHover,
  legs = null,
  // A save in flight for these appointments ("Saving…" on the card) and the signal
  // that "Today" was pressed, which scrolls the grid to the live time.
  savingIds = null,
  scrollToNowSignal = 0,
  // Blocked time and appointment menu actions — the Calendar owns the decisions,
  // the grid only reports what was tapped.
  onSetScheduleStatus, onEditBlock, onDeleteBlock, onBlockCommit,
}) {
  const scrollRef = useRef(null);
  const dragStateRef = useRef(null);
  const dragPreviewRef = useRef(null);
  const dragOccurredRef = useRef(false);
  const [dragApptId, setDragApptId] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [dragDayIndex, setDragDayIndex] = useState(null);
  const [invalidMsg, setInvalidMsg] = useState(null);
  const [lockedMovePrompt, setLockedMovePrompt] = useState(null);
  // The live clock, re-read every minute so the "now" line slides down the grid on its
  // own rather than jumping whenever something else happens to re-render.
  const [nowMinutes, setNowMinutes] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const bounds = getOverallBounds(businessHours);
  const HOUR_START = Math.max(0, Math.floor(bounds.start));
  const HOUR_END = Math.min(24, Math.ceil(bounds.end));
  // Half-hour steps: the grid is read in 30-minute increments, so every half hour
  // gets its own rule and label (full hours darker, half hours lighter and dashed).
  const ticks = Array.from({ length: (HOUR_END - HOUR_START) * 2 }, (_, i) => HOUR_START + i / 2);
  const totalHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;
  const today = new Date();
  const todayDecimal = nowMinutes / 60;

  // "Today" scrolls the grid to where the day actually is — a button that only changed
  // the date would leave the barber scrolling to find the red line.
  useEffect(() => {
    if (!scrollToNowSignal || !scrollRef.current) return;
    const onToday = days.some(d => isSameDay(d, new Date()));
    const target = onToday ? todayDecimal : 8;
    scrollRef.current.scrollTo({
      top: Math.max(0, (target - HOUR_START) * PX_PER_HOUR - 120),
      behavior: 'smooth',
    });
    // Only when the button is pressed: the signal is the trigger, not the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToNowSignal]);

  const dayNames = days.map(d => format(d, 'EEEE'));
  // Every column is a real calendar date. Records are grouped by their exact
  // date — never by weekday name, so a record can only ever appear on its own date.
  const dayDates = days.map(d => dateKey(d));
  const apptsByDay = dayDates.map(k => appointments.filter(a => a.date === k && !a.isBlock));
  const blocksByDay = dayDates.map(k => appointments.filter(a => a.date === k && a.isBlock));
  const previewByDay = dayDates.map(k => previewAppointments.filter(a => a.date === k && !a.isBlock));
  // While a card is dragged its home column stops showing it and the column under the
  // pointer shows it instead — so the gesture reads as one card moving between days.
  const draggedAppt = dragApptId ? appointments.find(a => a.id === dragApptId) : null;
  const cardColumns = days.map((_, i) => {
    const cards = apptsByDay[i].filter(a => a.id !== dragApptId);
    if (draggedAppt && dragDayIndex === i) cards.push(draggedAppt);
    return cards;
  });
  // The appointment whose preferred availability is on screen: the one being dragged,
  // or the one open in the detail panel.
  const selectedAppt = selectedApptId ? appointments.find(a => a.id === selectedApptId) : null;

  // ── Dragging a booking request onto the selected day ─────────────────────
  // The grid owns the pixel scale and the column rectangles, so it works out where
  // the pointer is; the decision about that time belongs to the shared validator (on
  // drop) and to lib/placementPreview (for the preview). Nothing is written here.
  const colRefs = useRef({});
  const placementActive = !!placement;
  const placementWindow = placementActive
    ? parseAvailabilityWindow(placement?.request?.availability_window)
    : null;
  const placementDragRef = useRef(null);
  placementDragRef.current = placement;
  const placementHoverRef = useRef(null);
  placementHoverRef.current = onPlacementHover;
  const geomRef = useRef(null);
  geomRef.current = { days, selectedDate, dayNames, dayDates, apptsByDay, blocksByDay, businessHours, hourStart: HOUR_START, hourEnd: HOUR_END };

  useEffect(() => {
    if (!placementActive) return undefined;
    const onMove = (e) => {
      const g = geomRef.current;
      const p = placementDragRef.current;
      if (!g || !p) return;
      const idx = g.selectedDate ? g.days.findIndex(d => isSameDay(d, g.selectedDate)) : -1;
      const el = idx >= 0 ? colRefs.current[idx] : null;
      if (!el) return placementHoverRef.current?.(null);
      const rect = el.getBoundingClientRect();
      const near = e.clientX >= rect.left - 70 && e.clientX <= rect.right + 70
        && e.clientY >= rect.top - 70 && e.clientY <= rect.bottom + 70;
      placementHoverRef.current?.(near ? computeDropHover(g, p, rect, e.clientY) : null);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [placementActive]);

  // Click, or click and drag, on an empty part of a column. A click opens the form at
  // that time; a drag picks the range it covers and opens the form at its start — the
  // dragged length is only a preview, because the service sets the real duration.
  const rangeSelect = useGridRangeSelect({
    pxPerHour: PX_PER_HOUR,
    hourStart: HOUR_START,
    hourEnd: HOUR_END,
    enabled: !placementActive,
    onSelect: ({ start, end, meta }) => {
      const dayName = dayNames[Number(meta)];
      if (!dayName) return;
      if (end != null) onEmptyRange?.(dayName, start, end);
      else onEmptyClick?.(dayName, start);
    },
  });

  // ── Drag to move: any time, any day ──────────────────────────────────
  // A card can be dropped on any column and any time inside working hours. The grid
  // only reports where the pointer is; the backend validator decides on drop whether
  // that time is actually allowed. Nothing here writes a booking.
  const handleMouseDown = useCallback((e, appt, dayIndex) => {
    if (appt.status === 'completed' || appt.status === 'cancelled' || appt.isBlock) return;
    if (!onUpdateAppointment) return;
    // Protection: settings can forbid moving a locked or confirmed appointment. Say so —
    // a drag that simply does nothing reads like a broken calendar.
    const refuse = (message) => {
      setInvalidMsg(message);
      setTimeout(() => setInvalidMsg(null), 3000);
    };
    if (appt.schedule_status === 'locked' && protectionSettings?.allow_manual_move_locked === false) {
      refuse('This appointment is locked. Unlock it before moving.');
      return;
    }
    if (appt.schedule_status === 'confirmed' && protectionSettings?.allow_manual_move_confirmed === false) {
      refuse('This appointment is confirmed with the client. Unlock it before moving.');
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    const columnEl = e.currentTarget.closest('[data-day-column]');
    if (!columnEl) return;

    const startY = e.clientY;
    let dragActivated = false;
    let holdTimer = null;

    // Whichever column the pointer is over is the day the card would land on.
    const columnAt = (clientX) => {
      for (let idx = 0; idx < days.length; idx += 1) {
        const el = colRefs.current[idx];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) return { index: idx, rect };
      }
      return null;
    };

    const onMouseMove = (ev) => {
      if (!dragActivated || !dragStateRef.current) return;
      ev.preventDefault();
      const target = columnAt(ev.clientX);
      if (!target) return;
      const { offsetY, appt: a } = dragStateRef.current;
      const raw = (ev.clientY - target.rect.top - offsetY) / PX_PER_HOUR + HOUR_START;
      const snapped = snapTo5(raw);
      const dur = a.apptEnd - a.apptStart;

      // Free movement within operating hours; availability is checked on drop
      const clamped = Math.max(HOUR_START, Math.min(HOUR_END - dur, snapped));

      // Track whether the proposed position is outside the customer's availability
      const availMin = a.windowStart != null ? a.windowStart : -Infinity;
      const availMax = a.windowEnd != null ? a.windowEnd - dur : Infinity;
      const outOfBounds = snapped < availMin || snapped > availMax;

      // Overlap is judged against the column the card is headed for, because that is
      // the day it will live on if it is dropped there.
      const clash = [...apptsByDay[target.index], ...blocksByDay[target.index]].find(x =>
        x.id !== a.id && x.status !== 'cancelled' && x.status !== 'completed' &&
        overlaps(clamped, clamped + dur, x.apptStart, x.apptEnd)
      );

      dragStateRef.current.targetIndex = target.index;
      const preview = { start: clamped, end: clamped + dur, invalid: !!clash, conflict: !!clash, outOfBounds };
      dragPreviewRef.current = preview;
      setDragPreview(preview);
      setDragDayIndex(target.index);
    };

    const onMouseUp = () => {
      clearTimeout(holdTimer);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (dragActivated && dragStateRef.current) {
        dragOccurredRef.current = true;
        const preview = dragPreviewRef.current;
        const { appt: a } = dragStateRef.current;
        const targetIndex = dragStateRef.current.targetIndex ?? dayIndex;
        const targetDate = dayDates[targetIndex];
        const movedDay = !!targetDate && targetDate !== a.date;
        if (preview && !preview.invalid) {
          // A time outside the client's preferred availability is not blocked: the
          // barber's placement is saved, the booking is flagged as awaiting their
          // confirmation, and the confirmation message goes out. The barber is told
          // afterwards — never asked beforehand.
          const outside = preview.outOfBounds === true;
          const prev = {
            apptStart: a.apptStart, apptEnd: a.apptEnd, bufferEnd: a.bufferEnd,
            availability_override: a.availability_override, override_status: a.override_status,
            date: a.date, day: a.day,
          };
          const changes = {
            apptStart: preview.start,
            apptEnd: preview.start + (a.apptEnd - a.apptStart),
            bufferEnd: preview.start + (a.apptEnd - a.apptStart) + ((a.bufferEnd || a.apptEnd) - a.apptEnd),
            availability_override: outside,
            override_status: outside ? 'awaiting_confirmation' : 'none',
            // Across days the date travels with the time, so the card lands on the day
            // it was dropped on rather than snapping back to its old one.
            ...(movedDay ? { date: targetDate, day: dayNames[targetIndex] } : {}),
          };
          const opts = {
            commit: true,
            override: outside,
            overrideReason: outside ? 'Placed outside preferred availability — confirmation requested' : null,
          };
          // A locked time is the only move that still asks: the lock is a deliberate
          // decision, so overriding it is confirmed. A confirmed appointment simply
          // moves — its client-notification state is reported afterwards instead.
          if (a.schedule_status === 'locked' && protectionSettings?.allow_manual_move_locked !== false) {
            setLockedMovePrompt({ appt: a, preview, changes, prevState: prev, opts });
          } else {
            onUpdateAppointment(a.id, changes, true, prev, opts);
          }
        } else if (preview && preview.conflict) {
          setInvalidMsg('Time conflict with another appointment');
          setTimeout(() => setInvalidMsg(null), 2500);
        }
      }

      dragStateRef.current = null;
      dragPreviewRef.current = null;
      setDragApptId(null);
      setDragPreview(null);
      setDragDayIndex(null);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    holdTimer = setTimeout(() => {
      dragActivated = true;
      const columnRect = columnEl.getBoundingClientRect();
      const offsetY = startY - columnRect.top - (appt.apptStart - HOUR_START) * PX_PER_HOUR;
      dragStateRef.current = { apptId: appt.id, offsetY, appt, targetIndex: dayIndex };
      setDragApptId(appt.id);
      setDragDayIndex(dayIndex);
    }, HOLD_MS);
  }, [onUpdateAppointment, HOUR_START, HOUR_END, apptsByDay, blocksByDay, dayDates, dayNames, protectionSettings, days]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Day headers */}
      <div className="flex border-b border-zinc-200 shrink-0 bg-white">
        <div className="w-16 shrink-0 border-r border-zinc-200" />
        {days.map((day, i) => {
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const isToday = isSameDay(day, today);
          const closed = !isDayOpen(businessHours, dayNames[i]);
          return (
            <button
              key={i}
              onClick={() => onSelectDate?.(day)}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 border-l border-zinc-200 py-3 transition-colors hover:bg-[#f8f6ff]',
                isSelected ? 'bg-[#f3efff] ring-1 ring-inset ring-[#7c3aed]/40' : 'bg-white'
              )}
            >
              <span className={cn('text-[10px] font-bold tracking-widest uppercase', isSelected ? 'text-[#6d28d9]' : 'text-zinc-500')}>
                {format(day, 'EEE')}
              </span>
              <span className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all',
                isSelected
                  ? 'bg-[#7c3aed] text-white shadow-sm'
                  : isToday
                  ? 'border border-[#7c3aed]/30 text-[#6d28d9]'
                  : 'text-zinc-700'
              )}>
                {format(day, 'd')}
              </span>
              {closed && <span className="text-[9px] text-zinc-500 font-medium">Closed</span>}
            </button>
          );
        })}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-white [scrollbar-color:theme(colors.zinc.300)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar]:h-[6px] [&::-webkit-scrollbar]:w-[6px] [&::-webkit-scrollbar-track]:bg-transparent">
        <div className="flex" style={{ height: totalHeight + 'px' }}>
          {/* Time axis */}
          <div className="w-16 shrink-0 relative bg-white border-r border-zinc-200">
            {ticks.map((t, ti) => {
              const onHour = Number.isInteger(t);
              // Each label is centred on its own rule via translate, which stays
              // exact whatever the font metrics are. The first one would sit above
              // the top edge, so it hangs below its rule instead of being clipped.
              return (
                <div
                  key={t}
                  className={cn(
                    'absolute right-2.5 whitespace-nowrap leading-none tabular-nums',
                    onHour ? 'text-[10px] font-semibold text-zinc-500' : 'text-[9px] font-medium text-zinc-400',
                    ti === 0 ? 'translate-y-0' : '-translate-y-1/2',
                  )}
                  style={{ top: (t - HOUR_START) * PX_PER_HOUR + (ti === 0 ? 2 : 0) }}
                >
                  {decimalToLabel(t)}
                </div>
              );
            })}
          </div>

          {/* Day columns */}
          <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day, i) => {
              const isToday = isSameDay(day, today);
              const closed = !isDayOpen(businessHours, dayNames[i]);
              const dayBounds = getOperatingBounds(businessHours, dayNames[i]);
              const draggedAppt = dragDayIndex === i && dragApptId ? apptsByDay[i].find(a => a.id === dragApptId) : null;
              // The appointment whose preferred availability is shaded: the one being
              // dragged, or the one open in the detail panel on this column.
              const focusAppt = draggedAppt
                || (selectedAppt && selectedAppt.date === dayDates[i] ? selectedAppt : null);

              const isSelectedCol = selectedDate && isSameDay(day, selectedDate);
              return (
                <div
                  key={i}
                  data-day-column
                  ref={el => { colRefs.current[i] = el; }}
                  className={cn(
                    'relative cursor-pointer border-l border-zinc-200 transition-colors duration-150',
                    isSelectedCol ? 'bg-[#f3efff]' : 'hover:bg-[#fbfaff]'
                  )}
                  style={{ height: totalHeight }}
                  onPointerDown={(e) => rangeSelect.onPointerDown(e, i)}
                >
                  {/* Grid lines — the calendar is read in 30-minute increments, so
                      every half hour has its own line: full hours solid and darker,
                      half hours light and dashed. */}
                  {ticks.map(t => (
                    <div
                      key={t}
                      className={cn(
                        'absolute left-0 right-0 border-t',
                        // Full hours carry the eye down the grid; the half hour is
                        // only a step, so it stays lighter and dotted.
                        Number.isInteger(t) ? 'border-zinc-300' : 'border-dotted border-zinc-200/60',
                      )}
                      style={{ top: (t - HOUR_START) * PX_PER_HOUR }}
                    />
                  ))}

                  {/* While a request is being dragged, the day it is headed for is the only
                      one that matters: the others step back under a wash (not a fade), so
                      nothing moves and every column stays clickable. */}
                  {placementActive && !isSelectedCol && (
                    <div className="absolute inset-0 z-[45] bg-white opacity-60 pointer-events-none" />
                  )}

                  {/* Non-operating hours dimming */}
                  {closed ? (
                    <div className="absolute inset-0 bg-zinc-100 pointer-events-none" />
                  ) : dayBounds ? (
                    <>
                      {dayBounds.start > HOUR_START && (
                        <div className="absolute left-0 right-0 bg-zinc-50 pointer-events-none" style={{ top: 0, height: (dayBounds.start - HOUR_START) * PX_PER_HOUR }} />
                      )}
                      {dayBounds.end < HOUR_END && (
                        <div className="absolute left-0 right-0 bg-zinc-50 pointer-events-none" style={{ top: (dayBounds.end - HOUR_START) * PX_PER_HOUR, bottom: 0 }} />
                      )}
                    </>
                  ) : null}

                  {/* Current time indicator */}
                  {/* The live clock: a labelled time chip, a quiet pulsing dot and a fine
                      line across the day. Its position is eased over a minute, so it drifts
                      down rather than stepping. */}
                  {isToday && todayDecimal >= HOUR_START && todayDecimal < HOUR_END && (
                    <div
                      className="absolute left-0 right-0 z-30 flex items-center pointer-events-none transition-[top] duration-[60000ms] ease-linear"
                      style={{ top: (todayDecimal - HOUR_START) * PX_PER_HOUR }}
                    >
                      <span className="-ml-0.5 shrink-0 rounded bg-red-500 px-1 py-[1px] text-[9px] font-bold leading-none tabular-nums text-white">
                        {decimalToLabel(todayDecimal)}
                      </span>
                      <span className="relative -ml-1 flex h-2 w-2 shrink-0 items-center justify-center">
                        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-400 opacity-50" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                      </span>
                      <span className="h-px flex-1 bg-red-500/60" />
                    </div>
                  )}

                  {/* The client's preferred availability, shaded while their appointment
                      is being dragged or is open in the detail panel. It marks where the
                      client asked to be seen — NOT a boundary: the card may sit outside
                      it, and the client is then asked to confirm. Not a calendar block,
                      and it sits beneath the cards so it can never cover one. */}
                  {focusAppt && !focusAppt.isBlock &&
                    focusAppt.windowStart != null && focusAppt.windowEnd != null && (
                    <div
                      className="absolute left-0 right-0 pointer-events-none z-0"
                      style={{
                        top: (focusAppt.windowStart - HOUR_START) * PX_PER_HOUR,
                        height: (focusAppt.windowEnd - focusAppt.windowStart) * PX_PER_HOUR,
                      }}
                    >
                      <div className="absolute inset-0 bg-[#7c3aed]/[0.08] border-y border-dashed border-[#8b5cf6]/40" />
                      <span className="absolute top-1 left-2 text-[9px] font-semibold uppercase tracking-wide text-violet-600/70">
                        Preferred availability · {decimalToLabel(focusAppt.windowStart)}–{decimalToLabel(focusAppt.windowEnd)}
                      </span>
                    </div>
                  )}

                  {/* The dragged customer's availability, shown only while a request is
                      being placed from the drawer. Temporary: it is not a calendar block
                      and it disappears the moment the drag ends. The dashed line marks the
                      latest start that still fits the whole service — a window ending at
                      3:00pm with a 35-minute cut leaves 2:25pm, not 3:00pm. */}
                  {placementActive && isSelectedCol && placementWindow && (() => {
                    const latest = latestValidStart(placementWindow, placement?.request?.duration_mins);
                    const offset = Math.max(0, Math.min(placementWindow.end - placementWindow.start, (latest ?? placementWindow.end) - placementWindow.start));
                    return (
                      <div
                        className="absolute left-0 right-0 z-[1] pointer-events-none"
                        style={{
                          top: Math.max(0, (placementWindow.start - HOUR_START) * PX_PER_HOUR),
                          height: (placementWindow.end - placementWindow.start) * PX_PER_HOUR,
                        }}
                      >
                        <div className="absolute inset-0 bg-[#7c3aed]/[0.10] border-y border-dashed border-[#7c3aed]/50" />
                        <span className="absolute top-1 left-2 text-[9px] font-bold uppercase tracking-wide text-violet-700">
                          Client availability {decimalToLabel(placementWindow.start)}–{decimalToLabel(placementWindow.end)}
                        </span>
                        {latest != null && (
                          <>
                            <div className="absolute left-0 right-0 border-t border-dashed border-[#7c3aed]/60" style={{ top: offset * PX_PER_HOUR }} />
                            <span className="absolute right-1.5 text-[9px] font-semibold text-violet-700 bg-white/80 px-1 rounded" style={{ top: offset * PX_PER_HOUR + 2 }}>
                              latest start {decimalToLabel(latest)}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* Blocked time — the same interactive block as the day view: tap for
                      its menu, drag to move it, pull the bottom edge to resize it. */}
                  {blocksByDay[i].map(appt => (
                    <BlockTimeCard
                      key={appt.id}
                      appt={appt}
                      topPx={(appt.apptStart - HOUR_START) * PX_PER_HOUR}
                      heightPx={Math.max((appt.apptEnd - appt.apptStart) * PX_PER_HOUR, 36)}
                      hourStart={HOUR_START}
                      hourEnd={HOUR_END}
                      onCommit={onBlockCommit}
                      onEdit={onEditBlock}
                      onDelete={onDeleteBlock}
                    />
                  ))}

                  {/* Auto Sort ghost cards (proposed positions) */}
                  {previewByDay[i].map(appt => {
                    const topPx = (appt.apptStart - HOUR_START) * PX_PER_HOUR;
                    const heightPx = Math.max((appt.apptEnd - appt.apptStart) * PX_PER_HOUR, 44);
                    return (
                      <div key={`ghost-${appt.id}`} className="absolute left-1 right-1 rounded-lg border-2 border-dashed border-[#6366f1]/40 bg-[#6366f1]/[0.06] p-2 pointer-events-none z-[1]" style={{ top: topPx + 'px', height: heightPx + 'px' }}>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] font-bold text-indigo-600/80 shrink-0">{decimalToLabel(appt.apptStart)}</span>
                          <span className="text-[10px] font-semibold text-indigo-600/70 truncate">{appt.clientName}</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Appointment cards (draggable) */}
                  {cardColumns[i].map(appt => {
                    const isDragging = dragApptId === appt.id;
                    const preview = isDragging ? dragPreview : null;
                    const renderStart = preview ? preview.start : appt.apptStart;
                    const topPx = (renderStart - HOUR_START) * PX_PER_HOUR;
                    const heightPx = cardHeightPx(appt);
                    const isCancelled = appt.status === 'cancelled';
                    const isCompleted = appt.status === 'completed';
                    const dur = appt.apptEnd - appt.apptStart;
                    const saving = savingIds?.has?.(appt.id) === true;
                    return (
                      <React.Fragment key={appt.id}>
                        {/* While dragging: the exact start and end it would land on, and what a
                            drop there will do — amber means the client will be asked to confirm,
                            red means the drop is refused. The warning arrives before the drop,
                            never after it. */}
                        {preview && (
                          <div
                            className="pointer-events-none absolute left-0.5 right-0.5 z-[47] flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md bg-zinc-900 px-1.5 py-1 text-[10px] font-bold leading-none text-white shadow-lg"
                            style={{ top: topPx - 30 }}
                          >
                            <span className="tabular-nums">
                              {decimalToLabel(renderStart)} – {decimalToLabel(renderStart + dur)}
                            </span>
                            {dragDayIndex != null && days[dragDayIndex] && dayDates[dragDayIndex] !== appt.date && (
                              <span className="rounded bg-white/15 px-1 font-semibold text-violet-100">
                                {format(days[dragDayIndex], 'EEE d MMM')}
                              </span>
                            )}
                            <span className={cn(
                              'font-semibold',
                              preview.conflict ? 'text-red-300' : preview.outOfBounds ? 'text-amber-300' : 'text-emerald-300',
                            )}>
                              {preview.conflict ? 'Conflict' : preview.outOfBounds ? 'Client will confirm' : 'Drop to move'}
                            </span>
                          </div>
                        )}

                        {/* A save still in flight, said on the card itself. The calendar is
                            never blocked while the server catches up. */}
                        {saving && !isDragging && (
                          <div
                            className="pointer-events-none absolute right-1 z-[47] rounded bg-white/95 px-1.5 py-0.5 text-[9px] font-bold leading-none text-indigo-600 shadow-sm ring-1 ring-indigo-100"
                            style={{ top: topPx - 16 }}
                          >
                            Saving…
                          </div>
                        )}

                        <div
                        data-appt
                        onMouseDown={(e) => handleMouseDown(e, appt, i)}
                        onClick={(e) => { e.stopPropagation(); if (dragOccurredRef.current) { dragOccurredRef.current = false; return; } onOpenDetail(appt); }}
                        className={cn(
                          'absolute left-0.5 right-0.5 rounded-lg flex overflow-hidden group select-none',
                          // Glides into its new slot; while dragged it only traces the snap.
                          isDragging ? 'cal-drag cursor-grabbing z-30' : 'cal-move z-10',
                          isCancelled ? 'opacity-70 cursor-default' : isCompleted ? 'cursor-default' : 'cursor-grab',
                          !isDragging && !isCancelled && !isCompleted && 'hover:z-20 hover:-translate-y-px hover:shadow-md'
                        )}
                        style={{
                          top: topPx + 'px', height: heightPx + 'px',
                          // Light neon purple: a soft violet fill with a violet edge, so a card
                          // reads as a plan that can still be moved. Colour no longer tells
                          // services apart — the service is written on the card instead.
                          // A pale purple plan, not a glowing block: soft fill, one
                          // quiet border, and a shadow that only lifts on a drag.
                          background: isCancelled ? '#fafafa' : '#f8f6ff',
                          border: isCancelled ? '1px dashed #d4d4d8' : '1px solid',
                          borderColor: isCancelled
                            ? undefined
                            : isDragging
                              ? preview?.conflict ? '#ef4444' : preview?.outOfBounds ? '#f59e0b' : '#8b5cf6'
                              : '#e3ddfb',
                          boxShadow: isDragging
                            ? '0 4px 12px rgba(76,29,149,0.14)'
                            : '0 1px 2px rgba(88,28,135,0.06)',
                        }}
                      >
                        {/* Content — glanceable: start time, client, service, minimal badges */}
                        <AppointmentBlockContent
                          appt={appt}
                          startLabel={decimalToLabel(renderStart)}
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

                  {/* Required travel and each remaining gap are explained separately. */}
                  {!dragApptId && (
                    <CalendarGapLayer appointments={[...apptsByDay[i], ...blocksByDay[i]]}
                      legs={legs} bounds={dayBounds} hourStart={HOUR_START} pxPerHour={PX_PER_HOUR} />
                  )}

                  {/* Where the dragged request would land, and what the engine makes of it.
                      Green = inside the customer's window with no conflict, amber = outside it
                      (an administrator may override, and the customer is asked), red = a hard
                      rule is broken. This is only the reading; the drop is re-validated. */}
                  {placementActive && placement?.hover && placement.hover.index === i && (() => {
                    const hover = placement.hover;
                    const boxPx = Math.max((hover.durationMins || 30) / 60 * PX_PER_HOUR, 30);
                    return (
                      <div
                        className={cn(
                          'absolute left-0.5 right-0.5 z-[46] pointer-events-none overflow-hidden rounded-lg border-2 border-dashed px-1.5 py-1',
                          DROP_TONE[hover.state] || DROP_TONE.invalid,
                        )}
                        style={{ top: (hover.startDecimal - HOUR_START) * PX_PER_HOUR, height: boxPx }}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className="shrink-0 text-[10px] font-bold tabular-nums">{decimalToLabel(hover.startDecimal)}</span>
                          <span className="truncate text-[10px] font-semibold">{placement.request?.client_name}</span>
                        </div>
                        {hover.state !== 'valid' && (
                          <p className="mt-0.5 text-[9px] leading-tight">{hover.reason}</p>
                        )}
                      </div>
                    );
                  })()}

                  {/* The range being dragged: translucent purple, from where the drag
                      started to where the pointer is now. */}
                  {rangeSelect.preview && rangeSelect.preview.index === i && (
                    <div
                      className="pointer-events-none absolute left-0.5 right-0.5 z-[44] rounded-lg border-2 border-dashed border-violet-400 bg-violet-500/15 px-1.5 py-1"
                      style={{
                        top: (rangeSelect.preview.start - HOUR_START) * PX_PER_HOUR,
                        height: Math.max((rangeSelect.preview.end - rangeSelect.preview.start) * PX_PER_HOUR, 20),
                      }}
                    >
                      <span className="whitespace-nowrap text-[10px] font-bold text-violet-700">
                        {decimalToLabel(rangeSelect.preview.start)} – {decimalToLabel(rangeSelect.preview.end)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Invalid placement message */}
      {invalidMsg && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-xs font-semibold shadow-lg">
          {invalidMsg}
        </div>
      )}

      {/* A confirmed appointment moves without asking: its new time is saved and the
          client-notification state is reported afterwards. Only a lock still asks. */}

      {/* Locked appointment move warning */}
      {lockedMovePrompt && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl bg-white border border-indigo-500/30 shadow-xl flex items-center gap-4 max-w-md">
          <AlertCircle className="w-5 h-5 text-indigo-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-indigo-700">Move locked appointment?</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              This time was intentionally locked. Moving {lockedMovePrompt.appt.clientName} to {decimalToLabel(lockedMovePrompt.preview.start)} will override that lock.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setLockedMovePrompt(null)} className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 px-3 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors">Cancel</button>
            <button onClick={() => {
              const { appt: a, changes, prevState, opts } = lockedMovePrompt;
              onUpdateAppointment(a.id, changes, true, prevState, opts);
              setLockedMovePrompt(null);
            }} className="text-xs font-bold text-indigo-700 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 rounded-lg transition-colors">Move Anyway</button>
          </div>
        </div>
      )}

    </div>
  );
}