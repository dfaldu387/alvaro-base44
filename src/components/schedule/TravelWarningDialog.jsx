import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Travel time that cannot be achieved — the one thing the barber is asked about.
 *
 * A direct overlap is never offered at all; a travel shortfall is a real
 * judgement call (the client is waiting, the day is tight), so the facts are put
 * on screen and the barber decides. Placing anyway is an authorised override and
 * is recorded in the audit trail with its reason.
 */
export default function TravelWarningDialog({ prompt, busy = false, onCancel, onConfirm }) {
  if (!prompt) return null;
  const { clientName, timeLabel, lines = [], requiredMins, availableMins, earliestLabel } = prompt;

  const Fact = ({ label, value }) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="text-[11px] font-bold tabular-nums text-zinc-900">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 px-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-zinc-900">Travel time may not be achievable</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
              {clientName ? `${clientName} at ` : ''}{timeLabel} leaves too little time to drive between appointments.
            </p>
          </div>
        </div>

        {lines.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            {lines.map((line, i) => (
              <li key={i} className="text-[11px] leading-snug text-amber-800">{line}</li>
            ))}
          </ul>
        )}

        {(requiredMins != null || availableMins != null || earliestLabel) && (
          <div className="mt-3 divide-y divide-zinc-100 rounded-xl border border-zinc-200 px-3">
            {requiredMins != null && <Fact label="Travel required" value={`${requiredMins} min`} />}
            {availableMins != null && <Fact label="Travel available" value={`${availableMins} min`} />}
            {earliestLabel && <Fact label="Earliest recommended start" value={earliestLabel} />}
          </div>
        )}

        <p className="mt-3 text-[10px] leading-snug text-zinc-400">
          Placing anyway records an override with your name and its reason.
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-500/10 px-3.5 py-2 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          >
            {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />}
            Place Anyway
          </button>
        </div>
      </div>
    </div>
  );
}