import React from 'react';
import { cn } from '@/lib/utils';
import { ago, stamp, nextExpected } from '@/lib/automation';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const Row = ({ label, children, tone }) => (
  <p className={cn('text-xs break-words', tone || 'text-zinc-600')}><span className="font-semibold text-zinc-500">{label}: </span>{children}</p>
);

function badge(v) {
  if (v.neverRun) return ['Never run', 'failed'];
  if (v.hb?.last_outcome === 'failed') return ['Last run failed', 'failed'];
  if (v.overdue) return ['Overdue', 'failed'];
  if (v.hb?.last_outcome === 'no_op') return ['Ran — nothing to do', 'neutral'];
  return ['Ran — did work', 'success'];
}

export default function JobCard({ job, schedule, view }) {
  const [label, cls] = badge(view);
  const hb = view.hb;
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-zinc-900">{job.name}</p>
        <StatusBadge status={cls}>{label}</StatusBadge>
      </div>
      <Row label="Schedule">{schedule}</Row>
      {view.neverRun ? (
        <Row label="Last run" tone="text-red-700 font-semibold">Never run. No run has been recorded, so nothing confirms this job is working.</Row>
      ) : (
        <Row label="Last run">{ago(view.lastRunAt)} ({stamp(view.lastRunAt)})</Row>
      )}
      {hb ? (
        <>
          <Row label="What it did">
            {hb.processed ?? 0} processed · {hb.sent ?? 0} {job.sentLabel.toLowerCase()} · {hb.suppressed ?? 0} suppressed · {hb.failed ?? 0} failed
          </Row>
          {hb.last_outcome === 'no_op' && hb.last_reason && <Row label="Did nothing because">{hb.last_reason}</Row>}
          {hb.last_detail && <Row label="Detail">{hb.last_detail}</Row>}
          {hb.last_acted_at && <Row label="Last did work">{ago(hb.last_acted_at)} ({stamp(hb.last_acted_at)})</Row>}
        </>
      ) : !view.neverRun && <Row label="What it did">Not recorded — the run counts appear after the next scheduled run.</Row>}
      <Row label="Next expected">{stamp(nextExpected(job.key))} (about {ago(nextExpected(job.key)).replace(/^in /, '')} from now)</Row>
      <Row label="Last error" tone={view.error ? 'text-red-600' : undefined}>{view.error || 'None'}</Row>
    </li>
  );
}