import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';

const Stat = ({ label, value }) => (
  <div className="rounded-lg border border-zinc-200 bg-white p-2 min-w-0">
    <p className="text-lg font-bold text-zinc-900">{value}</p>
    <p className="text-[11px] text-zinc-500 break-words">{label}</p>
  </div>
);

/**
 * Measures every client's real visit rhythm. Preview first: it shows who would become due sooner or
 * later and writes nothing. Applying changes dates only; no message is sent. The campaign preview
 * (dry run) above then shows exactly who would be contacted with the new dates.
 */
export default function CadenceBackfillPanel({ onApplied }) {
  const [report, setReport] = useState(null);
  const [monthly, setMonthly] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const call = async (apply) => {
    setBusy(apply ? 'apply' : 'preview'); setError('');
    try {
      const r = (await base44.functions.invoke('cadenceBackfill', { apply, monthly_is_default: monthly })).data;
      if (!r.ok) throw new Error(r.error);
      setReport(r.report);
      if (apply) onApplied?.();
    } catch (e) { setError(e?.response?.data?.error || e?.message || 'Something went wrong.'); }
    setBusy('');
  };

  return (
    <details className="rounded-xl border border-zinc-200 bg-white">
      <summary className="cursor-pointer p-3 text-sm font-bold text-zinc-900">Reminder timing from real visits</summary>
      <div className="space-y-3 p-3">
        <p className="text-xs text-zinc-600">Works out how often each client really comes in (the middle gap between their last completed visits, at least 4 visits). A client you set by hand is never changed. Nothing is sent from here.</p>
        <label className="flex items-start gap-2 text-xs text-zinc-700">
          <input type="checkbox" className="mt-0.5" checked={monthly} onChange={(e) => { setMonthly(e.target.checked); setReport(null); }} />
          <span>Older clients labelled just "Monthly" were never chosen by me, so measured timing may replace it.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => call(false)} disabled={!!busy} className="h-10 px-4 rounded-md border border-zinc-300 text-sm font-semibold text-zinc-800 disabled:opacity-50">{busy === 'preview' ? 'Working…' : 'Preview changes'}</button>
          <button onClick={() => { if (window.confirm('Save the measured timing and move the reminder dates shown? No messages are sent.')) call(true); }} disabled={!!busy || !report || report.applied} className="h-10 px-4 rounded-md bg-indigo-600 text-sm font-semibold text-white disabled:opacity-40">{busy === 'apply' ? 'Saving…' : 'Apply'}</button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {report && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-800">{report.applied ? `Done. ${report.records_written} clients updated.` : 'Preview only. Nothing has been changed.'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Measured" value={report.measured} />
              <Stat label="Not enough history" value={report.lacked_history} />
              <Stat label="Left alone (you set them)" value={report.left_alone_manual} />
              <Stat label="Unconfirmed Monthly, not used" value={report.ambiguous_not_used} />
              <Stat label="Due sooner" value={report.dates_sooner} />
              <Stat label="Due later" value={report.dates_later} />
              <Stat label="Become due now" value={report.becoming_due_now} />
              <Stat label="Date set by hand, kept" value={report.dates_left_alone} />
            </div>
            {report.changes.length > 0 && (
              <ul className="text-[11px] text-zinc-600 space-y-0.5 max-h-48 overflow-y-auto">
                {report.changes.map((c) => <li key={c.id} className="break-words">{c.name}: {c.from || 'no date'} to {c.to} ({c.days_before || '?'} to {c.days_after} days)</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}