import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { asList } from '@/lib/conversations';

const BAD = { $in: ['failed', 'dead_letter'] };

/**
 * Everything that did not get delivered, in one list: Message rows the provider
 * reported failed, plus outbox items that failed or were dead-lettered (given up).
 * Counts come from count(); the lists are the newest 50 of each.
 */
export default function useDeliveryProblems(tick) {
  const [state, setState] = useState({ count: 0, items: [], loading: true, error: false });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [mCount, oCount, msgs, outs] = await Promise.all([
          base44.entities.Message.count({ delivery_status: 'failed' }),
          base44.entities.MessageOutbox.count({ status: BAD }),
          base44.entities.Message.filter({ delivery_status: 'failed' }, { sort: '-created_date', limit: 50 }),
          base44.entities.MessageOutbox.filter({ status: BAD }, { sort: '-updated_date', limit: 50 }),
        ]);
        const messages = asList(msgs);
        const outbox = asList(outs);

        // Outbox rows queued by booking id only: find the booking's client.
        const bookingIds = [...new Set(outbox.filter((o) => !o.client_id && o.booking_request_id).map((o) => o.booking_request_id))];
        const bookings = bookingIds.length
          ? asList(await base44.entities.BookingRequest.filter({ id: { $in: bookingIds } }, { limit: 100, fields: ['id', 'client_id', 'client_name'] }))
          : [];
        const bookingById = Object.fromEntries(bookings.map((b) => [b.id, b]));
        const clientIds = [...new Set([
          ...messages.map((m) => m.client_id),
          ...outbox.map((o) => o.client_id || bookingById[o.booking_request_id]?.client_id),
        ].filter(Boolean))];
        const clients = clientIds.length
          ? asList(await base44.entities.ReminderClient.filter({ id: { $in: clientIds } }, { limit: 200 }))
          : [];
        const nameById = Object.fromEntries(clients.map((c) => [c.id, c.client_name]));

        const items = [
          ...messages.map((m) => ({
            key: `m-${m.id}`, clientId: m.client_id, name: nameById[m.client_id] || 'Unknown client',
            kind: 'Delivery failed', reason: m.delivery_error ? `Provider error ${m.delivery_error}` : 'The provider reported it failed.',
            at: m.created_date,
          })),
          ...outbox.map((o) => {
            const clientId = o.client_id || bookingById[o.booking_request_id]?.client_id || null;
            return {
              key: `o-${o.id}`, clientId,
              name: nameById[clientId] || bookingById[o.booking_request_id]?.client_name || o.payload?.name || 'Unknown client',
              kind: o.status === 'dead_letter' ? 'Dead-lettered' : 'Failed',
              reason: o.dead_letter_reason || o.last_error || 'Could not be delivered.',
              at: o.updated_date || o.created_date,
            };
          }),
        ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

        if (live) setState({ count: mCount + oCount, items, loading: false, error: false });
      } catch {
        if (live) setState((s) => ({ ...s, loading: false, error: true }));
      }
    })();
    return () => { live = false; };
  }, [tick]);

  return state;
}