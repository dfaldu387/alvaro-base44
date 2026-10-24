import { format } from 'date-fns';

export const asList = (r) => (Array.isArray(r) ? r : (r?.items || []));

export const when = (v) => (v ? format(new Date(v), 'd MMM, h:mm a') : '');

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One label + colour per delivery state shown in a thread.
export const STATUS_META = {
  queued: { label: 'Queued', cls: 'bg-zinc-100 text-zinc-600' },
  sent: { label: 'Sent', cls: 'bg-blue-50 text-blue-700' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
  suppressed: { label: 'Suppressed', cls: 'bg-amber-50 text-amber-700' },
  dead_letter: { label: 'Dead-lettered', cls: 'bg-red-100 text-red-800' },
  received: { label: 'Received', cls: 'bg-zinc-100 text-zinc-600' },
  read: { label: 'Read', cls: 'bg-emerald-50 text-emerald-700' },
  draft: { label: 'Draft', cls: 'bg-zinc-100 text-zinc-600' },
};

const messageTime = (m) => m.sent_date || m.received_date || m.created_date;

/** A Message row as a thread entry. */
export function messageEntry(m) {
  const incoming = m.direction === 'incoming';
  return {
    id: `m-${m.id}`,
    direction: m.direction,
    text: m.message_text,
    channel: m.message_type || 'sms',
    status: m.delivery_status || (incoming ? 'received' : 'sent'),
    at: messageTime(m),
    manual: !incoming && m.manual_or_automated === 'manual',
    automated: !incoming && m.manual_or_automated !== 'manual',
    simulated: m.simulated === true,
    bookingId: m.booking_request_id || '',
    note: m.delivery_status === 'failed' && m.delivery_error ? `Provider error ${m.delivery_error}` : '',
  };
}

/** An outbox row that has not become a Message yet (queued, held, suppressed or failed). */
export function outboxEntry(o) {
  const dead = o.status === 'dead_letter' || o.status === 'failed';
  const status = o.status === 'dead_letter' ? 'dead_letter' : dead ? 'failed' : o.status === 'suppressed' ? 'suppressed' : 'queued';
  let note = '';
  if (dead) note = o.dead_letter_reason || o.last_error || 'Could not be delivered.';
  else if (o.status === 'suppressed') note = `Not sent: ${o.suppressed_reason || 'suppressed'}.`;
  else if (o.deferral_reason) note = o.deferral_reason;
  else if (o.last_error) note = `Retrying after: ${o.last_error}`;
  return {
    id: `o-${o.id}`,
    direction: 'outgoing',
    text: o.rendered_text || o.payload?.text || `(${String(o.template_key || 'message').replace(/_/g, ' ')} — text is built when it is sent)`,
    channel: o.channel || 'sms',
    status,
    at: o.created_date,
    manual: o.is_manual === true,
    automated: o.is_manual !== true,
    simulated: false,
    bookingId: o.booking_request_id || '',
    note,
  };
}

/** Messages + not-yet-sent outbox rows, oldest first. Sent outbox rows are already a Message. */
export function buildTimeline(messages, outbox) {
  const fromOutbox = outbox.filter((o) => o.status !== 'sent').map(outboxEntry);
  return [...messages.map(messageEntry), ...fromOutbox]
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

/** Newest-first Message rows → one row per client for the list. */
export function toConversations(messages, clients) {
  const seen = new Map();
  for (const m of messages) {
    if (!m.client_id || seen.has(m.client_id)) continue;
    seen.set(m.client_id, conversationFor(m.client_id, clients[m.client_id], m));
  }
  return [...seen.values()];
}

export function conversationFor(clientId, client, lastMessage) {
  return {
    clientId,
    name: client?.client_name || 'Unknown client',
    phone: client?.phone || '',
    isTest: client?.is_test === true,
    optedOut: client?.messaging_opted_out === true,
    lastText: lastMessage?.message_text || '',
    lastAt: lastMessage ? messageTime(lastMessage) : null,
    lastDirection: lastMessage?.direction || null,
    failed: lastMessage?.delivery_status === 'failed',
  };
}