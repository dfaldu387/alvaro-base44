import React from 'react';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import DraftActions from '@/components/assistant/DraftActions';
import { OUTCOME_META, CLASS_LABEL } from '@/lib/assistant';
import { when } from '@/lib/conversations';

/** One inbound message the assistant handled: what came in, what it decided, and why. Reads at 360px. */
export default function AssistantEventCard({ event, name, onOpenConversation, onChanged }) {
  const meta = OUTCOME_META[event.outcome] || OUTCOME_META.processing;
  const pct = typeof event.confidence === 'number' ? `${Math.round(event.confidence * 100)}%` : null;
  const sentLine = event.draft_status === 'sent'
    ? `${event.send_kind === 'manual' ? 'Manual' : 'Automated'} · sent by ${event.sent_by || 'assistant'}`
    : null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3.5 space-y-2.5 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        <StatusBadge tone="neutral">{CLASS_LABEL[event.classification] || CLASS_LABEL.none}{pct ? ` · ${pct}` : ''}</StatusBadge>
        {event.guard_fired && <StatusBadge tone="danger">Guard fired</StatusBadge>}
        <span className="text-[11px] text-zinc-400 ml-auto">{when(event.received_at || event.created_date)}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-zinc-900 break-words">
          {name || 'Unknown number'}{!event.client_id && event.from_phone ? ` · ${event.from_phone}` : ''}
        </p>
        <p className="text-sm text-zinc-800 whitespace-pre-wrap break-words mt-0.5">“{event.inbound_text}”</p>
      </div>
      {event.reason && <p className="text-xs text-zinc-600 break-words">{event.reason}</p>}
      {event.guard_reasons?.length > 0 && (
        <ul className="text-[11px] text-red-700 list-disc pl-4 space-y-0.5 break-words">{event.guard_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      )}
      {event.draft_text && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-1">{event.draft_status === 'pending' ? 'Draft reply' : event.draft_status === 'discarded' ? 'Discarded draft' : 'Reply'}</p>
          <p className="text-sm text-zinc-800 whitespace-pre-wrap break-words">{event.draft_text}</p>
        </div>
      )}
      <DraftActions event={event} onChanged={onChanged} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        {sentLine && <span>{sentLine}</span>}
        {event.llm_calls > 0 && <span>~{(event.est_tokens_in || 0) + (event.est_tokens_out || 0)} tokens (estimate)</span>}
        {event.assistant_mode && <span>mode: {event.assistant_mode}</span>}
        {onOpenConversation && event.client_id && (
          <button onClick={() => onOpenConversation(event.client_id)} className="font-semibold text-indigo-600 hover:text-indigo-700 min-h-[44px] sm:min-h-0">Open conversation</button>
        )}
      </div>
    </div>
  );
}