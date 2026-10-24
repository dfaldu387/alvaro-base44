import React, { useEffect, useState, useCallback } from 'react';
import { X, Loader2, CalendarPlus, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import TimeSelect from '@/components/ui/TimeSelect';
import { applyManualPlacement } from '@/lib/manualPlacement';
import { placementErrorMessage, VIOLATION_CODES } from '@/lib/placementValidation';
import { suggestPlacementSlots } from '@/lib/requestAdmin';

/**
 * Add to Calendar — a lightweight manual scheduling flow.
 *
 * It shows the request (client, service, duration, submitted window, address) and
 * the times the shared scheduling engine actually accepts, so the admin picks a
 * time that can be placed. The placement itself still goes through
 * applyManualPlacement, which re-validates immediately before saving with the same
 * validator Route Flow uses — nothing here decides validity.
 *
 * An invalid time is refused with its exact reason. An administrator may then use
 * the existing Schedule Anyway override, which is recorded in the audit log; the
 * validator is never bypassed, and a hard conflict (an overlap or a protected
 * appointment) cannot be overridden at all.
 */
export default function AddToCalendarModal({ request, onClose, onDone, provisional = false }) {
  const [context, setContext] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [error, setError] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const date = context?.date || request.requested_date || '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    suggestPlacementSlots({ booking_request_id: request.id })
      .then(data => {
        if (cancelled) return;
        setContext(data || null);
        const found = data?.slots || [];
        setSlots(found);
        setTime(found[0]?.start_decimal ?? null);
      })
      .catch(() => { if (!cancelled) setError('We could not check this request against the schedule.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request.id]);

  const place = useCallback(async (useOverride) => {
    if (time == null) { setError('Choose a time first.'); return; }
    setSaving(true);
    setError('');
    setRefusal(null);

    const data = await applyManualPlacement({
      requestId: request.id,
      startDecimal: time,
      date: date || undefined,
      day: request.day,
      barberId: request.team_member_id || null,
      expectedUpdatedDate: request.updated_date || null,
      // Provisional: the time is held, the booking is not confirmed and the
      // customer is not messaged. Confirming is a separate decision.
      confirmRequest: provisional !== true,
      override: useOverride === true,
      overrideReason: useOverride ? (overrideReason.trim() || 'Scheduled anyway from Booking Requests') : null,
      note: 'Added to the calendar manually',
    });

    setSaving(false);
    if (data?.saved === true) {
      onDone?.();
      onClose?.();
      return;
    }
    setRefusal(data || { error: 'That time did not pass the schedule check.' });
  }, [time, date, request, overrideReason, provisional, onDone, onClose]);

  const violations = refusal?.result?.violations || [];
  const bounds = context?.working_hours?.normal || null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-zinc-200 shadow-xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 shrink-0">
          <h2 className="text-base font-bold text-zinc-900">Add to Calendar</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* The request, exactly as submitted */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-900 truncate">{request.client_name}</p>
              <span className="text-xs text-zinc-500 shrink-0">{date || request.day}</span>
            </div>
            <p className="text-xs text-zinc-600">
              {(request.services || []).join(' + ') || 'Service'} · {request.duration_mins || 0} min
            </p>
            <p className="text-xs text-zinc-500">
              Available {request.availability_window || 'Flexible'}
              {request.address ? ` · ${request.address}` : ''}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />Checking the schedule…
            </div>
          ) : (
            <>
              {/* Times the shared validator accepts */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Suggested times</p>
                {slots.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map(slot => (
                      <button
                        key={slot.start_decimal}
                        type="button"
                        onClick={() => { setTime(slot.start_decimal); setRefusal(null); setError(''); }}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                          time === slot.start_decimal
                            ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:border-indigo-300'
                        }`}
                      >
                        {slot.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-800">No valid time on this date</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {context?.reason || 'No slot fitted inside the customer’s availability.'}
                      </p>
                      {(context?.blocking_codes || []).length > 0 && (
                        <p className="text-[11px] text-amber-700/80 mt-1">
                          {(context.blocking_codes || []).map(c => VIOLATION_CODES[c] || c).join(' · ')}
                        </p>
                      )}
                      <p className="text-[11px] text-amber-700/80 mt-1">
                        You can still pick a time below — it will be checked the same way.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Any time, still validated */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Appointment time</p>
                <div className="flex items-center gap-3">
                  <TimeSelect
                    value={time ?? ''}
                    onChange={value => { setTime(value); setRefusal(null); setError(''); }}
                    startHour={Math.max(0, Math.floor(bounds?.start ?? 6))}
                    endHour={Math.min(24, Math.ceil(bounds?.end ?? 22))}
                  />
                  <span className="text-xs text-zinc-500">
                    {context?.calendar_minutes ? `${context.calendar_minutes} min on the calendar` : ''}
                  </span>
                </div>
              </div>

              {/* The validator's exact refusal */}
              {refusal && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 space-y-1">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-red-800">This time was refused</p>
                      {violations.length === 0 ? (
                        <p className="text-xs text-red-700 mt-0.5">
                          {refusal.message || refusal.error || placementErrorMessage(refusal.result)}
                        </p>
                      ) : (
                        <ul className="mt-0.5 space-y-0.5">
                          {violations.map((v, i) => (
                            <li key={`${v.code}-${i}`} className="text-xs text-red-700">
                              <span className="font-semibold">{VIOLATION_CODES[v.code] || v.code}:</span> {v.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Existing override flow — administrator only, always audited */}
                  {(refusal.can_override || violations.length > 0) && (
                    <div className="pt-2 mt-1 border-t border-red-200 space-y-2">
                      <p className="text-[11px] text-red-700">
                        An administrator can place this time anyway (Schedule Anyway). The override and
                        its reason are recorded in the audit log, and a hard conflict can never be overridden.
                      </p>
                      <input
                        value={overrideReason}
                        onChange={e => setOverrideReason(e.target.value)}
                        placeholder="Reason for the override"
                        className="w-full bg-white text-zinc-900 border border-red-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-red-400"
                      />
                      <button
                        type="button"
                        onClick={() => place(true)}
                        disabled={saving || !time}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Schedule Anyway
                      </button>
                    </div>
                  )}
                </div>
              )}

              {provisional && (
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  This goes on the calendar provisionally. Nothing is confirmed and no message is sent
                  until you confirm the day’s appointments.
                </p>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-zinc-200 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => place(false)}
            disabled={saving || loading || time == null}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
            {saving ? 'Placing…' : 'Place on Calendar'}
          </button>
        </div>
      </div>
    </div>
  );
}