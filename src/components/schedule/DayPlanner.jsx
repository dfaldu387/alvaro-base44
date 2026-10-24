import React, { useState, useRef, useCallback } from 'react';
import { Calendar, CheckCircle, Clock, Send, X, Eye, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { decimalToLabel } from '@/pages/admin/Schedule';

const HOUR_START = 9;
const HOUR_END = 21;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const PX_PER_HOUR = 72; // pixels per hour
const TOTAL_HEIGHT = TOTAL_HOURS * PX_PER_HOUR;
const SNAP_MINS = 15; // snap to 15 min increments

function decimalToPx(dec) {
  return (dec - HOUR_START) * PX_PER_HOUR;
}
function pxToDecimal(px) {
  return px / PX_PER_HOUR + HOUR_START;
}
function snapDecimal(dec) {
  const snapHours = SNAP_MINS / 60;
  return Math.round(dec / snapHours) * snapHours;
}

const STATUS_STYLE = {
  planned:   { bg: 'bg-primary',          border: 'border-primary/60',        text: 'text-primary-foreground' },
  waiting:   { bg: 'bg-yellow-600/80',    border: 'border-yellow-500/60',     text: 'text-zinc-900' },
  confirmed: { bg: 'bg-green-700/80',     border: 'border-green-500/60',      text: 'text-zinc-900' },
};

export default function DayPlanner({ day, date, appointments, onUpdateAppointment, onRemoveAppointment, onConfirmAppointment, onSendTime }) {
  const [selectedId, setSelectedId] = useState(null);
  const [dragWarning, setDragWarning] = useState(null);
  const plannerRef = useRef(null);

  const hours = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);

  const selectedAppt = appointments.find(a => a.id === selectedId);

  const handleSelect = (id) => {
    setSelectedId(prev => prev === id ? null : id);
    setDragWarning(null);
  };

  const handleDeselect = () => {
    setSelectedId(null);
    setDragWarning(null);
  };

  // Drag logic
  const dragState = useRef(null);

  const startDrag = useCallback((e, appt) => {
    if (appt.status === 'confirmed') return;
    e.preventDefault();
    e.stopPropagation();

    const plannerRect = plannerRef.current.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const apptTopPx = decimalToPx(appt.apptStart);
    const offsetY = clientY - plannerRect.top - apptTopPx;

    dragState.current = { appt, offsetY };

    const onMove = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const rect = plannerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rawPx = y - rect.top - dragState.current.offsetY;
      const rawDecimal = pxToDecimal(rawPx);
      const snapped = snapDecimal(rawDecimal);
      const dur = appt.apptEnd - appt.apptStart;

      // Clamp inside window
      const minStart = appt.windowStart;
      const maxStart = appt.windowEnd - dur;
      let newStart = Math.max(minStart, Math.min(maxStart, snapped));
      let newEnd = newStart + dur;

      // Check working hours
      if (newStart < HOUR_START || newEnd > HOUR_END) {
        setDragWarning('Appointment must stay within working hours.');
        return;
      }

      setDragWarning(null);
      onUpdateAppointment(appt.id, { apptStart: newStart, apptEnd: newEnd });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      dragState.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }, [onUpdateAppointment]);

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Today's Schedule</h2>
        </div>
        {date && (
          <span className="text-xs text-muted-foreground">
            {format(date, 'EEE d MMM')}
          </span>
        )}
      </div>

      {/* Warning */}
      {dragWarning && (
        <div className="mb-3 bg-yellow-500/10 border border-yellow-500/30 text-amber-700 text-xs px-3 py-2 rounded-xl">
          ⚠️ {dragWarning}
        </div>
      )}

      {/* Action panel for selected appointment */}
      {selectedAppt && (
        <AppointmentActions
          appt={selectedAppt}
          onConfirm={() => onConfirmAppointment(selectedAppt.id)}
          onSend={() => onSendTime(selectedAppt.id)}
          onRemove={() => { onRemoveAppointment(selectedAppt.id); setSelectedId(null); }}
          onDeselect={handleDeselect}
        />
      )}

      {/* Calendar grid */}
      <div
        className="relative flex-1 overflow-y-auto"
        style={{ minHeight: TOTAL_HEIGHT + 'px' }}
        onClick={handleDeselect}
      >
        <div
          ref={plannerRef}
          className="relative"
          style={{ height: TOTAL_HEIGHT + 'px' }}
        >
          {/* Hour lines */}
          {hours.map(h => (
            <div
              key={h}
              className="absolute left-0 right-0 flex items-start"
              style={{ top: (h - HOUR_START) * PX_PER_HOUR + 'px', height: PX_PER_HOUR + 'px' }}
            >
              <span className="text-xs text-muted-foreground w-14 pt-0 pr-2 text-right select-none shrink-0">
                {decimalToLabel(h)}
              </span>
              <div className="flex-1 border-t border-border/50 mt-0" />
            </div>
          ))}

          {/* Appointment blocks */}
          {appointments.map(appt => {
            const isSelected = selectedId === appt.id;
            const style = STATUS_STYLE[appt.status] || STATUS_STYLE.planned;
            const topPx = decimalToPx(appt.apptStart);
            const heightPx = (appt.apptEnd - appt.apptStart) * PX_PER_HOUR;
            const windowTopPx = decimalToPx(appt.windowStart);
            const windowHeightPx = (appt.windowEnd - appt.windowStart) * PX_PER_HOUR;

            return (
              <React.Fragment key={appt.id}>
                {/* Availability window highlight (only when selected) */}
                {isSelected && appt.windowStart && (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: '56px',
                      top: windowTopPx + 'px',
                      height: windowHeightPx + 'px',
                      right: '0px',
                      background: 'rgba(139,92,246,0.12)',
                      border: '1px dashed rgba(139,92,246,0.4)',
                      borderRadius: '12px',
                    }}
                  >
                    <span className="absolute top-1.5 left-3 text-xs text-violet-600 font-medium">
                      {appt.clientName} availability · {decimalToLabel(appt.windowStart)}–{decimalToLabel(appt.windowEnd)}
                    </span>
                  </div>
                )}

                {/* Appointment block */}
                <div
                  className={`absolute rounded-xl border ${style.bg} ${style.border} ${style.text} select-none transition-shadow ${
                    isSelected ? 'shadow-lg shadow-primary/30 ring-2 ring-primary/50 z-20' : 'z-10'
                  } ${appt.status !== 'confirmed' && isSelected ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                  style={{
                    left: '60px',
                    right: '4px',
                    top: topPx + 'px',
                    height: Math.max(heightPx, 44) + 'px',
                  }}
                  onClick={(e) => { e.stopPropagation(); handleSelect(appt.id); }}
                  onMouseDown={isSelected && appt.status !== 'confirmed' ? (e) => startDrag(e, appt) : undefined}
                  onTouchStart={isSelected && appt.status !== 'confirmed' ? (e) => startDrag(e, appt) : undefined}
                >
                  <div className="px-3 py-2 h-full flex flex-col justify-center">
                    <p className="text-xs font-bold leading-tight truncate">{appt.clientName}</p>
                    {appt.services?.length > 0 && (
                      <p className="text-xs opacity-80 truncate">{appt.services.join(' + ')}</p>
                    )}
                    <p className="text-xs opacity-70 mt-0.5">
                      {decimalToLabel(appt.apptStart)}–{decimalToLabel(appt.apptEnd)}
                    </p>
                    {appt.status === 'confirmed' && (
                      <span className="text-[10px] font-semibold opacity-90 mt-0.5">✓ Confirmed</span>
                    )}
                    {appt.status === 'waiting' && (
                      <span className="text-[10px] font-semibold opacity-90 mt-0.5">⏳ Waiting</span>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}

          {appointments.length === 0 && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ left: '56px' }}
            >
              <p className="text-muted-foreground text-sm">Add requests from the left to plan the day</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AppointmentActions({ appt, onConfirm, onSend, onRemove, onDeselect }) {
  return (
    <div
      className="mb-4 bg-card border border-primary/30 rounded-2xl p-4"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-bold text-foreground">{appt.clientName}</p>
          <p className="text-xs text-muted-foreground">{appt.services?.join(' + ')} · {appt.duration} min</p>
          <p className="text-xs text-primary mt-0.5">
            {decimalToLabel(appt.apptStart)} – {decimalToLabel(appt.apptEnd)}
          </p>
        </div>
        <button onClick={onDeselect} className="text-muted-foreground hover:text-foreground p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {appt.status === 'planned' && (
          <>
            <button
              onClick={onSend}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-all"
            >
              <Send className="w-3 h-3" /> Send Time to Client
            </button>
            <button
              onClick={onConfirm}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-all"
            >
              <CheckCircle className="w-3 h-3" /> Confirm Booking
            </button>
          </>
        )}
        {appt.status === 'waiting' && (
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-all"
          >
            <CheckCircle className="w-3 h-3" /> Confirm Booking
          </button>
        )}
        {appt.status === 'confirmed' && (
          <button
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground border border-border"
            disabled
          >
            <Eye className="w-3 h-3" /> Confirmed — Locked
          </button>
        )}
        <button
          onClick={onRemove}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600/10 text-red-600 border border-red-500/20 hover:bg-red-600/20 transition-all ml-auto"
        >
          <X className="w-3 h-3" /> Remove
        </button>
      </div>
    </div>
  );
}