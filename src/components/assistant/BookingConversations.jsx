import React from 'react';
import { CalendarCheck } from 'lucide-react';
import useBookingConversations from '@/hooks/useBookingConversations';
import BookingConversationCard from '@/components/assistant/BookingConversationCard';

/** The assistant's booking conversations for one client, shown on their thread in Messages. */
export default function BookingConversations({ clientId }) {
  const { items } = useBookingConversations(clientId);
  if (items.length === 0) return null;
  return (
    <details className="border-b border-zinc-200 bg-white">
      <summary className="px-4 py-2.5 flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer min-h-[44px]">
        <CalendarCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="flex-1">Assistant booking conversations · {items.length}</span>
      </summary>
      <div className="px-3 pb-3 space-y-2 max-h-80 overflow-y-auto">
        {items.map((it) => <BookingConversationCard key={it.convo.id} item={it} />)}
      </div>
    </details>
  );
}