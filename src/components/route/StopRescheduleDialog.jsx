import React, { useState } from 'react';
import { X, Loader2, CalendarClock, AlertTriangle } from 'lucide-react';
import BookingScheduleFields from '@/components/schedule/edit/BookingScheduleFields';
import { applyManualPlacement } from '@/lib/manualPlacement';

const OVERRIDE_CODES = ['AVAILABILITY_OVERRIDE_REQUIRED', 'BOOKING_WINDOW_OVERRIDE_REQUIRED', 'TRAVEL_OVERRIDE_REQUIRED'];

/**
 * Move one stop to another day or time from its Route card.
 *
 * The time is only a proposal: applyManualPlacement re-validates working hours, overlaps,
 * travel and the booking window exactly as a Calendar drag does, and a soft rule comes
 * back as an explicit override the barber has to press.
 */
export default function StopRescheduleDialog({ stop, onClose, onSaved }) {
  const [date, setDate] = useState(stop?.date || '');
  const [start, setStart] = useState(Number.isFinite(stop?.apptStart) ? stop.apptStart : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);

  if (!stop) return null;

  const save = async (override = false) => {
    if (busy) return;
    if (!date) { setError('Choose a date.'); return; }
    if (!Number.isFinite(Number(start))) { setError('Choose a start time.'); return; }
    setBusy(true);
    setError(null);
    const res = await applyManualPlacement({
      requestId: stop.requestId,
      startDecimal: Number(start),
      date,
      barberId: stop.teamMemberId || null,
      expectedUpdatedDate: stop.updatedDate || null,
      override,
      overrideTravel: warning?.code === 'TRAVEL_OVERRIDE_REQUIRED',
      overrideReason: override ? 'Rescheduled on the Route tab — authorised override' : null,
      note: 'Rescheduled on the Route tab',
    });
    setBusy(false);
    if (res?.saved === true) { onSaved?.(res); return; }
    if (OVERRIDE_CODES.includes(res?.code)) {
      setWarning({ code: res.code, message: res.message || 'This time needs your decision before it can be saved.' });
      return;
    }
    setError(res?.error || 'That time could not be validated.');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 lg:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-t-3xl border border-zinc-200 bg-white p-4 shadow-2xl lg:rounded-3xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-bold text-zinc-900">
              <CalendarClock className="h-4 w-4 text-[#7c3aed]" /> Reschedule
            </p>
            <p className="truncate text-[11px] text-zinc-500">{stop.clientName}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200">
            <X className="h-3.5 w-3.5 text-zinc-500" />
          </button>
        </div>

        <BookingScheduleFields
          date={date}
          start={start}
          onDate={setDate}
          onStart={setStart}
          durationMins={stop.duration}
          errors={{ date: error && !date ? error : undefined }}
        />

        {error && <p className="mt-2 text-[11px] font-medium text-red-600">{error}</p>}

        {warning && (
          <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="flex items-start gap-2 text-[11px] leading-snug text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {warning.message}
            </p>
            <button type="button" onClick={() => save(true)} disabled={busy}
              className="w-full rounded-lg bg-amber-600 py-2 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-50">
              Save anyway
            </button>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => save(false)} disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#7c3aed] py-2.5 text-xs font-bold text-white hover:bg-[#6d28d9] disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? 'Saving…' : 'Move appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}