import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageSquare, Route as RouteIcon, Unlink, X } from 'lucide-react';
import { fmtRouteMins } from '@/lib/dayRouteStatus';

/**
 * The connected day, at a glance.
 *
 * Sits in the top-right of the calendar so a route's cost — stops, driving, idle —
 * is readable without leaving the day, and holds the two things a connected day
 * can do next: take the route away again (Disconnect Day), or fix every time and
 * message every client (Confirm Appointments).
 *
 * A draft day shows no card at all: nothing is committed yet, and the one action
 * that commits it lives in the toolbar.
 */
function Stat({ value, label }) {
  return (
    <div className="min-w-0 flex-1 text-center">
      <p className="text-[15px] font-bold leading-none tabular-nums text-zinc-900">{value}</p>
      <p className="mt-1 text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-zinc-400">{label}</p>
    </div>
  );
}

export default function RouteSummaryCard({
  state, busy = false, dateLabel = '', appointments = 0, allConfirmed = false,
  onDisconnect, onConfirm, onViewRoute, confirming = false,
}) {
  const status = busy ? 'finalising' : (state?.status || 'draft');
  // Dismissible, never resolved by dismissing: the day stays out of date until
  // Connect Appointments is pressed again, so a small reminder stays in its place.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [state?.reason, status]);
  if (status === 'draft') return null;

  const needsUpdate = status === 'needs_update';

  if (needsUpdate && dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="cal-pop pointer-events-auto absolute right-3 top-[80px] z-30 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 shadow-sm"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-[11px] font-semibold text-amber-700">Route out of date</span>
      </button>
    );
  }
  const stops = state?.appointments ?? appointments;

  const rebuilding = state?.status === 'needs_update';
  const header = status === 'finalising'
    ? {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      tone: 'bg-[#6366f1]/10 text-indigo-600',
      title: rebuilding ? 'Rebuilding route…' : 'Connecting the day…',
      text: 'text-indigo-700',
    }
    : needsUpdate
    ? { icon: <AlertTriangle className="h-4 w-4" />, tone: 'bg-amber-100 text-amber-600', title: 'Route needs updating', text: 'text-amber-700' }
    : { icon: <CheckCircle2 className="h-4 w-4" />, tone: 'bg-emerald-100 text-emerald-600', title: allConfirmed ? 'Route confirmed' : 'Route connected', text: 'text-emerald-700' };

  return (
    <div className="cal-pop pointer-events-auto absolute right-3 top-[80px] z-30 w-[248px] max-w-[calc(100%-24px)] rounded-xl border border-zinc-200 bg-white p-3 shadow-md transition-colors">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${header.tone}`}>
          {header.icon}
        </span>
        <div className="min-w-0">
          <p className={`text-[13px] font-bold leading-tight ${header.text}`}>{header.title}</p>
          {dateLabel && <p className="mt-0.5 truncate text-[11px] leading-tight text-zinc-500">{dateLabel}</p>}
        </div>
        {needsUpdate && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss route warning"
            className="-mr-1 -mt-1 ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {status !== 'finalising' && (
        <>
          <div className="my-2.5 border-t border-zinc-100" />
          <div className="flex items-stretch">
            <Stat value={stops} label={stops === 1 ? 'Appointment' : 'Appointments'} />
            <span className="w-px bg-zinc-100" />
            <Stat value={fmtRouteMins(state?.drive_minutes)} label="Driving" />
            <span className="w-px bg-zinc-100" />
            <Stat value={fmtRouteMins(state?.idle_minutes)} label="Idle" />
          </div>
        </>
      )}

      {needsUpdate && (
        <p className="mt-2.5 text-[10px] leading-snug text-amber-700">
          {state?.reason || 'The day changed after the route was connected'} — press Connect Appointments again to update the times and driving.
        </p>
      )}

      {status !== 'finalising' && (
        <div className="mt-2.5 space-y-1.5">
          {/* One primary action per state: a stale route can only be rebuilt, and a day
              every client has confirmed opens its route instead of re-messaging them.
              Confirming is its own step — connecting never messages anyone. */}
          {allConfirmed && !needsUpdate ? (
            <button
              type="button"
              onClick={onViewRoute}
              title="Open the day's route"
              className="flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <RouteIcon className="h-3.5 w-3.5" /> View Route
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || confirming || stops === 0 || needsUpdate}
              title={needsUpdate
                ? 'Click Connect Appointments again first: the day changed after it was connected'
                : 'Fix every time and send each client their confirmation'}
              className="flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-[#6366f1] px-2 text-[11px] font-bold text-white transition-colors hover:bg-[#5851e0] disabled:opacity-40"
            >
              {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
              Confirm Appointments
            </button>
          )}
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            title="Remove the drive legs and take the day back to a draft"
            className="flex h-7 w-full items-center justify-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40"
          >
            <Unlink className="h-3 w-3" /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}