import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { asList, buildTimeline } from '@/lib/conversations';
import MessageBubble from '@/components/messages/MessageBubble';
import ManualSendBox from '@/components/messages/ManualSendBox';

/**
 * This booking's conversation, in a panel on the appointment.
 *
 * The same bubbles and the same composer as the Messages page, just smaller: every
 * row is a real Message or MessageOutbox record and replies go out through the
 * normal manual-send path, so nothing said here differs from the full page.
 */
export default function BookingMessages({ bookingId }) {
  const [state, setState] = useState({ entries: [], client: null, error: false });
  const [tick, setTick] = useState(0);
  const scrollerRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [booking, msgs, outbox] = await Promise.all([
          base44.entities.BookingRequest.get(bookingId),
          base44.entities.Message.filter({ booking_request_id: bookingId }, { limit: 100 }),
          base44.entities.MessageOutbox.filter({ booking_request_id: bookingId }, { limit: 100 }),
        ]);
        const entries = buildTimeline(asList(msgs), asList(outbox));
        let client = null;
        if (booking?.client_id) client = await base44.entities.ReminderClient.get(booking.client_id).catch(() => null);
        if (live) setState({ entries, client, error: false });
      } catch {
        if (live) setState({ entries: [], client: null, error: true });
      }
    })();
    return () => { live = false; };
  }, [bookingId, tick]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [state.entries.length]);

  const { entries, client, error } = state;

  return (
    <div className="rounded-xl border border-zinc-200">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <p className="text-xs font-bold text-zinc-700">Messages</p>
        {client && <Link to={`/admin/messages?client=${client.id}`} className="text-[11px] font-semibold text-[#7c3aed]">Full conversation</Link>}
      </div>
      <div ref={scrollerRef} className="max-h-[260px] space-y-2 overflow-y-auto border-t border-zinc-100 px-3 py-3">
        {error && <p className="text-xs text-red-600">Messages could not be loaded.</p>}
        {!error && entries.length === 0 && (
          <p className="py-4 text-center text-[11px] text-zinc-400">Nothing has been said about this booking yet.</p>
        )}
        {entries.map((entry) => <MessageBubble key={entry.id} entry={entry} />)}
      </div>
      {client && <ManualSendBox client={client} onQueued={() => setTick((t) => t + 1)} />}
    </div>
  );
}