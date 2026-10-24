import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/reminderMeta';

const STYLE = {
  error: 'border-red-300 bg-red-50 text-red-800',
  warn: 'border-amber-300 bg-amber-50 text-amber-800',
  info: 'border-zinc-200 bg-zinc-50 text-zinc-600',
};

/** Whether the campaign schedule is actually running, and the last run. Never hides a missing run. */
export default function RunHealthBanner({ health }) {
  const last = health.last_run;
  const when = last ? (fmtDate(last.finished_at || last.started_at) || 'unknown time') : null;
  return (
    <div className="space-y-2">
      {health.warnings.map((w, i) => (
        <div key={i} className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STYLE[w.level], w.level === 'error' && 'font-semibold')}>
          {w.level === 'info' ? <Info className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{w.text}</span>
        </div>
      ))}
      <p className="text-xs text-zinc-500">
        {last
          ? `Last campaign run: ${last.stage === 'outreach' ? 'reminders' : 'follow-ups'}, ${last.mode === 'live' ? 'live' : 'preview only'}, ${last.trigger}, status ${last.status}, ${when} (week ${last.week}).`
          : 'Last campaign run: none recorded.'}
      </p>
    </div>
  );
}