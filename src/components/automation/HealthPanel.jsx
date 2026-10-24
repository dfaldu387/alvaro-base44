import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STALE_MINUTES, ago, stamp, sweepAgeMinutes } from '@/lib/automation';

function Stat({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={cn('text-sm font-bold mt-1 break-words', tone || 'text-zinc-800')}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-400 mt-0.5 break-words">{sub}</p>}
    </div>
  );
}

export function StaleBanner({ health }) {
  const age = sweepAgeMinutes(health);
  if (age !== null && age <= STALE_MINUTES) return null;
  const text = !health
    ? 'There is no health record, so nothing confirms the background message engine has ever run.'
    : !health.last_run_at
      ? 'The health record has no sweep run time, so nothing confirms the engine is running.'
      : `The message sweep last ran ${ago(health.last_run_at)} (more than ${STALE_MINUTES} minutes ago).`;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4">
      <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-red-800">The background message engine may not be running</p>
        <p className="text-xs text-red-700 mt-1">{text} Queued messages will not go out until the sweep runs again.</p>
      </div>
    </div>
  );
}

export default function HealthPanel({ data }) {
  const { health: h, counts: c } = data;
  const fails = h?.consecutive_failures;
  const realToday = c.simToday === null ? null : c.sentToday - c.simToday;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Automation health</h2>
      {!h && <p className="text-xs text-red-600">Health information is unavailable: no sweep health record exists.</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Last sweep run" value={h?.last_run_at ? ago(h.last_run_at) : 'Unavailable'} sub={stamp(h?.last_run_at)} />
        <Stat label="Last successful run" value={h?.last_successful_at ? ago(h.last_successful_at) : 'Never recorded'} sub={stamp(h?.last_successful_at)} />
        <Stat label="Consecutive failures" value={fails === undefined || fails === null ? 'Unavailable' : fails} tone={fails > 0 ? 'text-red-600' : undefined} />
        <Stat label="Pending" value={c.pending} sub={`${c.claimed} claimed`} />
        <Stat label="Sent today" value={c.sentToday} sub={realToday === null ? 'real vs simulated unknown' : `${c.simToday} simulated · ${realToday} real`} />
        <Stat label="Failed" value={c.failed} tone={c.failed > 0 ? 'text-red-600' : undefined} />
        <Stat label="Dead-lettered" value={c.dead} tone={c.dead > 0 ? 'text-red-600' : undefined} />
        <Stat label="Suppressed" value={c.suppressed} />
      </div>
      {h?.last_error && <p className="text-xs text-red-600 break-words">Last sweep error: {h.last_error}</p>}
      <p className="text-[10px] text-zinc-400">"Sent today" counts outbox items marked sent and updated since midnight on this device. "Sent" is not "delivered".</p>
    </section>
  );
}