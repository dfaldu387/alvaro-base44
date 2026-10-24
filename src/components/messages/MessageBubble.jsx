import React from 'react';
import { STATUS_META, when } from '@/lib/conversations';
import ChatBubble from '@/components/chat/ChatBubble';

/** One timeline entry — a sent message, a reply, or a row still waiting in the queue. */
export default function MessageBubble({ entry }) {
  const out = entry.direction === 'outgoing';
  const status = STATUS_META[entry.status] || STATUS_META.sent;
  const meta = [String(entry.channel || 'sms').toUpperCase()];
  if (out) meta.push(entry.manual ? 'Manual' : 'Automated');
  else if (status.label !== 'Received') meta.push(status.label);
  if (out) meta.push(status.label);
  if (entry.simulated) meta.push('Test — not delivered');
  if (entry.bookingId) meta.push(`Booking …${String(entry.bookingId).slice(-6)}`);

  return (
    <ChatBubble
      incoming={!out}
      text={entry.text}
      at={when(entry.at)}
      meta={meta}
      note={entry.note}
    />
  );
}