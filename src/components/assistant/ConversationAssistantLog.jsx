import React from 'react';
import { Sparkles } from 'lucide-react';
import useAssistantEvents from '@/hooks/useAssistantEvents';
import AssistantEventCard from '@/components/assistant/AssistantEventCard';

/** The assistant's decisions for ONE client, shown on their conversation (not only in a log table). */
export default function ConversationAssistantLog({ clientId, client }) {
  const query = React.useMemo(() => ({ client_id: clientId }), [clientId]);
  const { events, reload } = useAssistantEvents(query, 20);
  if (events.length === 0) return null;
  const tokens = events.reduce((n, e) => n + (e.est_tokens_in || 0) + (e.est_tokens_out || 0), 0);
  const open = events.filter((e) => e.inbox_status === 'open').length;
  return (
    <details open={open > 0} className="border-b border-zinc-200 bg-white">
      <summary className="px-4 py-2.5 flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer min-h-[44px]">
        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        <span className="flex-1">Assistant · {events.length} message{events.length === 1 ? '' : 's'}{open > 0 ? ` · ${open} need you` : ''}</span>
        <span className="text-[11px] font-normal text-zinc-400">~{tokens} tokens</span>
      </summary>
      <div className="px-3 pb-3 space-y-2 max-h-72 overflow-y-auto">
        {events.map((e) => <AssistantEventCard key={e.id} event={e} name={client?.client_name} onChanged={reload} />)}
      </div>
    </details>
  );
}