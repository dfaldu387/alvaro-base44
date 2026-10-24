import React from 'react';
import useAssistantEvents from '@/hooks/useAssistantEvents';
import AssistantEventCard from '@/components/assistant/AssistantEventCard';
import ErrorState from '@/components/states/ErrorState';

const OPEN = { inbox_status: 'open' };

/** Everything the assistant left for Alvaro: escalations, change requests, waiting drafts, guard stops. */
export default function EscalationInbox({ onOpenConversation }) {
  const { events, names, loading, error, reload } = useAssistantEvents(OPEN);
  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (error) return <ErrorState title="Couldn't load the inbox" description="Please try again." onRetry={reload} />;
  if (events.length === 0) return <p className="text-sm text-zinc-500 text-center py-12">Nothing needs you. The assistant has nothing waiting.</p>;
  return (
    <div className="space-y-3">
      {events.map((e) => <AssistantEventCard key={e.id} event={e} name={names[e.client_id]} onOpenConversation={onOpenConversation} onChanged={reload} />)}
    </div>
  );
}