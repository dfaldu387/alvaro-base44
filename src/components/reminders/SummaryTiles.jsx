import React from 'react';
import { cn } from '@/lib/utils';

const Tile = ({ id, label, value, sub, active, onPick, tone }) => (
  <button onClick={() => onPick(active ? null : id)} className={cn('text-left rounded-lg border px-3 py-2 transition-colors', active ? 'border-indigo-500 bg-indigo-50' : 'border-zinc-200 bg-white hover:bg-zinc-50')}>
    <p className="text-[11px] text-zinc-500">{label}</p>
    <p className={cn('text-xl font-bold', tone || 'text-zinc-900')}>{value}</p>
    {sub && <p className="text-[10px] text-zinc-400 leading-tight">{sub}</p>}
  </button>
);

/** This week's numbers, all from the board's records. Click a tile to list exactly those clients. */
export default function SummaryTiles({ data, filter, onPick }) {
  const c = data.counts;
  const props = { onPick };
  const reasons = Object.entries(data.skip_reasons).map(([k, n]) => `${data.reason_labels?.[k] || k}: ${n}`).join(' · ');
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <Tile {...props} id="due" label="Due" value={c.due} active={filter === 'due'} />
        <Tile {...props} id="messaged_ok" label="Messaged" value={c.queued + c.sent + c.delivered} sub={`${c.queued} queued · ${c.sent} sent · ${c.delivered} delivered`} active={filter === 'messaged_ok'} />
        <Tile {...props} id="replied" label="Replied" value={c.replied} active={filter === 'replied'} />
        <Tile {...props} id="booked" label="Booked" value={c.booked} active={filter === 'booked'} />
        <Tile {...props} id="follow_up" label="Follow-up needed" value={c.follow_up} active={filter === 'follow_up'} />
        <Tile {...props} id="skipped" label="Skipped" value={c.skipped} sub={reasons || 'none'} active={filter === 'skipped'} />
        <Tile {...props} id="suppressed" label="Suppressed" value={c.suppressed} active={filter === 'suppressed'} tone={c.suppressed ? 'text-zinc-700' : undefined} />
        <Tile {...props} id="failed" label="Failed / dead-lettered" value={c.failed} active={filter === 'failed'} tone={c.failed ? 'text-red-600' : undefined} />
      </div>
      <p className={cn('text-[11px]', data.reconciles ? 'text-zinc-400' : 'text-red-600 font-semibold')}>
        {data.reconciles
          ? `Reconciled: ${c.contacted} clients contacted this week = ${c.messaged} messaged + ${c.follow_up} follow-up needed + ${c.replied} replied + ${c.booked} booked. Replied and booked clients are also counted in the message-status numbers above.`
          : 'These counts do not reconcile with the underlying records. Please report this.'}
      </p>
    </div>
  );
}