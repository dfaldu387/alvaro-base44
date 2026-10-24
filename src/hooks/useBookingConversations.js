import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { asList } from '@/lib/assistant';

/**
 * One client's assistant booking conversations, each joined to the booking it created and to the
 * customer messages that belong to it. The link is read from the booking itself
 * (assistant_conversation_id), so a booking can always be traced back to what caused it.
 */
export default function useBookingConversations(clientId) {
  const [state, setState] = useState({ items: [], loading: true });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const convos = asList(await base44.entities.AssistantConversation.filter({ client_id: clientId }, { sort: '-created_date', limit: 10 }));
        if (convos.length === 0) { if (live) setState({ items: [], loading: false }); return; }
        const ids = convos.map((c) => c.id);
        const [bookings, events] = await Promise.all([
          base44.entities.BookingRequest.filter({ assistant_conversation_id: { $in: ids } }, { limit: 20 }).then(asList),
          base44.entities.AssistantEvent.filter({ conversation_id: { $in: ids } }, { sort: 'created_date', limit: 60 }).then(asList),
        ]);
        const items = convos.map((c) => ({
          convo: c,
          booking: bookings.find((b) => b.assistant_conversation_id === c.id) || null,
          events: events.filter((e) => e.conversation_id === c.id),
        }));
        if (live) setState({ items, loading: false });
      } catch {
        if (live) setState({ items: [], loading: false });
      }
    })();
    return () => { live = false; };
  }, [clientId]);

  return state;
}