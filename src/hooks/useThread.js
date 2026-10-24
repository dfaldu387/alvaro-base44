import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { asList, buildTimeline } from '@/lib/conversations';

/**
 * One client's whole conversation: their Message rows (both directions) plus
 * outbox rows that have not become a Message yet. Outbox rows are found by
 * client and by the client's bookings, because booking texts are queued by
 * booking id.
 */
export default function useThread(clientId, tick) {
  const [state, setState] = useState({ client: null, timeline: [], loading: false, error: false });

  useEffect(() => {
    if (!clientId) { setState({ client: null, timeline: [], loading: false, error: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: s.client?.id !== clientId }));
    (async () => {
      try {
        const [client, msgs, bookings] = await Promise.all([
          base44.entities.ReminderClient.get(clientId),
          base44.entities.Message.filter({ client_id: clientId }, { sort: '-created_date', limit: 300 }),
          base44.entities.BookingRequest.filter({ client_id: clientId }, { limit: 100, fields: ['id'] }),
        ]);
        const bookingIds = asList(bookings).map((b) => b.id);
        const [byClient, byBooking] = await Promise.all([
          base44.entities.MessageOutbox.filter({ client_id: clientId }, { sort: '-created_date', limit: 100 }),
          bookingIds.length
            ? base44.entities.MessageOutbox.filter({ booking_request_id: { $in: bookingIds } }, { sort: '-created_date', limit: 100 })
            : Promise.resolve([]),
        ]);
        const outbox = new Map();
        for (const o of [...asList(byClient), ...asList(byBooking)]) outbox.set(o.id, o);
        if (!live) return;
        setState({ client, timeline: buildTimeline(asList(msgs), [...outbox.values()]), loading: false, error: false });
      } catch {
        if (live) setState((s) => ({ ...s, loading: false, error: true }));
      }
    })();
    return () => { live = false; };
  }, [clientId, tick]);

  return state;
}