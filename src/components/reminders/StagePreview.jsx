import React from 'react';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const Section = ({ title, count, children }) => (
  <div className="space-y-1">
    <p className="text-xs font-bold text-zinc-700">{title} ({count})</p>
    {count === 0 ? <p className="text-xs text-zinc-400">None</p> : children}
  </div>
);

const Item = ({ i, showMessage }) => (
  <div className="rounded-lg border border-zinc-200 bg-white p-2 space-y-1">
    <p className="text-sm font-semibold text-zinc-900">{i.client_name} <span className="text-[10px] font-normal text-zinc-500">· {i.eligibility} · channel {i.channel.toUpperCase()}</span></p>
    {showMessage && i.message && <p className="whitespace-pre-wrap rounded bg-zinc-100 p-2 text-xs text-zinc-800">{i.message}</p>}
    {i.reason_text && <p className="text-xs text-amber-700">{i.reason_text}</p>}
    {i.idempotency_key && <p className="break-all text-[10px] text-zinc-400">Dedup key: {i.idempotency_key}</p>}
  </div>
);

/** One stage of the dry-run preview: who, the exact text, who is excluded and why, and the effect of the cap. */
export default function StagePreview({ title, s }) {
  if (!s.run) return <div className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500">{title}: no preview has been run this week yet. Press "Run preview".</div>;
  const r = s.run;
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-sm font-bold text-zinc-900">{title} <StatusBadge tone="warning" className="ml-1">Dry run — nothing sent</StatusBadge></p>
      {s.projection && <p className="text-xs text-zinc-500">Projection: assumes the clients in the reminder preview were contacted first. Real follow-ups are decided again at the time.</p>}
      <p className="text-xs text-zinc-600">Candidates {r.eligible_total} · would send {r.messages_counted} · over the limit {r.capped_count} · excluded {r.skipped_count}. Limit per run: {r.max_per_run}. {r.capped_count > 0 ? `The limit cuts off ${r.capped_count} eligible clients; they would wait for the next run.` : 'The limit does not cut anyone off.'}</p>
      <p className="text-xs text-zinc-500">Wording: {s.template.source === 'draft' ? 'draft wording (not yet saved or approved)' : s.template.active ? 'saved and switched on' : 'saved but switched off'}. {s.template.unknown_variables.length ? `Unknown variables: ${s.template.unknown_variables.join(', ')}.` : 'All variables are filled.'} Real outbox entries created by this preview: {s.queued_in_outbox}.</p>
      <Section title="Would receive this message" count={s.would_send.length}>{s.would_send.map((i) => <Item key={i.client_id} i={i} showMessage />)}</Section>
      <Section title="Over the run limit" count={s.capped.length}>{s.capped.map((i) => <Item key={i.client_id} i={i} showMessage />)}</Section>
      <Section title="Excluded, with reason" count={s.excluded.length}>{s.excluded.map((i) => <Item key={i.client_id} i={i} />)}</Section>
      <Section title="Missing data or variables" count={s.missing_data.length}>{s.missing_data.map((i) => <Item key={i.client_id} i={i} />)}</Section>
    </div>
  );
}