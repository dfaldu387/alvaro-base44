import React, { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import useThread from '@/hooks/useThread';
import MessageBubble from '@/components/messages/MessageBubble';
import ManualSendBox from '@/components/messages/ManualSendBox';
import ConversationAssistantLog from '@/components/assistant/ConversationAssistantLog';
import BookingConversations from '@/components/assistant/BookingConversations';
import ErrorState from '@/components/states/ErrorState';
import { initials } from '@/lib/reminderUtils';

/**
 * One conversation: a minimal header, the messages as bubbles, and the composer.
 * The same component serves the Messages page, the Route stop and anywhere else a
 * full thread is opened, so messaging always behaves the same way.
 */
export default function ConversationThread({ clientId, tick, onBack, onQueued }) {
  const { client, timeline, loading, error } = useThread(clientId, tick);
  const endRef = useRef(null);
  const scrollerRef = useRef(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [timeline.length, clientId]);

  if (error && !client) {
    return <div className="flex flex-1 items-center justify-center"><ErrorState title="Couldn't load this conversation" description="Please try again." /></div>;
  }
  if (!client) {
    return <div className="flex flex-1 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#7c3aed] border-t-transparent" /></div>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5">
        <button onClick={onBack} className="-ml-1 p-1 text-zinc-500 md:hidden" aria-label="Back to conversations"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600">
          {initials(client.client_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-zinc-900">{client.client_name}</p>
          <p className="truncate text-[11px] text-zinc-400">{client.phone || 'No phone number'}</p>
        </div>
        {client.is_test === true && <StatusBadge tone="test">TEST</StatusBadge>}
        {client.messaging_opted_out === true && <StatusBadge tone="warning">OPTED OUT</StatusBadge>}
      </div>
      <ConversationAssistantLog clientId={clientId} client={client} />
      <BookingConversations clientId={clientId} />
      <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto bg-white px-4 py-4" aria-busy={loading}>
        {timeline.length === 0 && <p className="py-10 text-center text-xs text-zinc-400">No messages with this client yet.</p>}
        {timeline.map((entry) => <MessageBubble key={entry.id} entry={entry} />)}
        <div ref={endRef} />
      </div>
      <ManualSendBox client={client} onQueued={onQueued} />
    </div>
  );
}