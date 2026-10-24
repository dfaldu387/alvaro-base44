import React from 'react';
import { cn } from '@/lib/utils';
import { describeStatus, stamp } from '@/lib/automation';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const Line = ({ label, children, tone }) => (
  <p className={cn('text-xs break-words', tone || 'text-zinc-600')}><span className="font-semibold text-zinc-500">{label}: </span>{children}</p>
);

const MODE_NOTES = {
  'messaging is switched off': 'Blocked by the messaging mode: messaging is switched Off, so this message was not sent to anyone.',
  'not on the messaging allowlist': 'Blocked by the messaging mode: messaging is set to Allowlist only and this number is not on the list, so it was not sent.',
};

export default function QueueRow({ o, msg, client }) {
  const st = describeStatus(o, msg);
  const who = client?.client_name || (o.client_id ? 'Client record not found' : 'No linked client');
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={st.key}>{st.label}</StatusBadge>
        {o.is_test === true && <StatusBadge status="test">Test mode — not delivered</StatusBadge>}
        <span className="text-[11px] text-zinc-400 ml-auto">{stamp(o.created_date)}</span>
      </div>
      <p className="text-sm font-semibold text-zinc-900 break-words">{who} <span className="font-normal text-zinc-500">· {o.to_address}</span></p>
      <p className="whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-xs text-zinc-800">{o.rendered_text || 'Not rendered yet — the text is built when the sweep processes it.'}</p>
      <Line label="Template">{o.template_key || 'none'}</Line>
      <Line label="Channel">{String(o.channel || '').toUpperCase()} · attempts {o.attempt_count ?? 0}</Line>
      {(o.booking_request_id || o.client_id) && <Line label="Linked">{[o.booking_request_id && `booking ${o.booking_request_id}`, o.client_id && `client ${o.client_id}`].filter(Boolean).join(' · ')}</Line>}
      {o.last_error && <Line label="Last error" tone="text-red-600">{o.last_error}</Line>}
      {o.dead_letter_reason && <Line label="Dead-letter reason" tone="text-red-600">{o.dead_letter_reason}</Line>}
      {o.suppressed_reason && <Line label="Suppression reason" tone="text-amber-700">{o.suppressed_reason}</Line>}
      {MODE_NOTES[o.suppressed_reason] && (
        <p className="rounded bg-amber-50 p-2 text-xs font-semibold text-amber-800">{MODE_NOTES[o.suppressed_reason]}</p>
      )}
      {o.deferral_reason && <Line label="Held" tone="text-amber-700">{o.deferral_reason}</Line>}
    </li>
  );
}