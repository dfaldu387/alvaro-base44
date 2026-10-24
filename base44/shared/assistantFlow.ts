import { normaliseAuPhone } from './auPhone.ts';
import { guardDraft } from './assistantGuard.ts';
import { buildContextPack, guardContextFor, type AssistantPack } from './assistantContext.ts';
import {
  classifyPrompt, draftPrompt, normaliseClassification, prescreen, estimateTokens, isSlotQuestion,
  CLASSIFY_SCHEMA, DRAFT_SCHEMA, type Llm,
} from './assistantAi.ts';
import {
  handleBookingTurn, loadActiveConversation, rescheduleOptions, BOOKING_REPLY_CAP, type BookingDeps,
} from './assistantBooking.ts';
import type { EnqueueInput, EnqueueResult } from './outboxEnqueue.ts';

/**
 * The AI inbound assistant, end to end. It is called by twilioInboundWebhook
 * ONLY after the keyword classifiers (STOP/START, YES/NO/CANCEL/RESCHEDULE)
 * have declined the message, so it never sees a keyword reply.
 *
 * What it can do:
 *   - read: the context pack (shared/assistantContext);
 *   - write: its own AssistantEvent log, a BookingReplyFlag ("needs attention")
 *     for a change request, and outbox rows through enqueueOutboxMessage.
 * What it can never do: update a BookingRequest, or send anything itself. Every
 * reply is an outbox row, so messaging_mode, opt-out, test-data, quiet-hours and
 * duplicate protections in the sweep apply exactly as for any other message.
 *
 * The ONE exception (shared/assistantBooking): when a known client accepts a time
 * the scheduling engine returned in that conversation, the assistant may CREATE a
 * BookingRequest, only through the shared booking creator, only as `pending`, and
 * only after the slot was re-validated at the moment of acceptance. It never
 * updates, moves, confirms or cancels an existing booking. See ADMIN_UI.md.
 */

export type AssistantMode = 'off' | 'draft' | 'live';
export const parseAssistantMode = (v: unknown): AssistantMode => (v === 'off' || v === 'live' || v === 'draft' ? v : 'draft');

/** At most this many assistant replies (drafts, queued answers, acknowledgements) per phone number in 24 hours. */
export const DAILY_REPLY_CAP = 4;
/** This many messages from one number inside the window counts as a burst: escalate, never draft. */
export const BURST_MESSAGES = 5;
export const BURST_WINDOW_MINUTES = 10;
export const MODEL_TIMEOUT_MS = 10_000;

const REPLY_OUTCOMES = ['drafted', 'queued', 'acknowledged'];
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export interface FlowInput {
  sid: string;
  from: string;
  body: string;
  numMedia?: number;
  clients: any[];
  /** Our own sending number(s): a message from one of these is never answered. */
  ownNumbers: string[];
  now?: Date;
}
export interface FlowDeps {
  llm: Llm;
  enqueue: (admin: any, input: EnqueueInput) => Promise<EnqueueResult>;
  /**
   * Free-text booking conversations (shared/assistantBooking). When absent, or when
   * assistant_mode is off, a "what times do you have?" message is escalated exactly as before.
   */
  booking?: BookingDeps;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The model took too long.')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** The fixed acknowledgement for a change request. Contains no time; the guard proves it. */
export function acknowledgementText(firstName: string | null): string {
  const hello = firstName ? `Hi ${firstName}, thanks.` : 'Thanks.';
  return `${hello} We've received your request and Alvaro will confirm with you.`;
}

export async function handleInbound(admin: any, input: FlowInput, deps: FlowDeps): Promise<any> {
  const now = input.now || new Date();
  const existing = asList(await admin.entities.AssistantEvent.filter({ provider_message_id: input.sid }, 'created_date', 1))[0];
  if (existing) return existing; // one assistant reply per inbound message, however often Twilio retries

  const phone = normaliseAuPhone(input.from);
  const settings = asList(await admin.entities.MessagingSettings.list('-created_date', 1))[0];
  const mode = parseAssistantMode(settings?.assistant_mode);
  const realClients = input.clients.filter(c => c.is_test !== true);
  const client = realClients.length === 1 ? realClients[0] : null;

  let ev = await admin.entities.AssistantEvent.create({
    provider_message_id: input.sid, from_phone: phone || '', client_id: client?.id || undefined,
    inbound_text: input.body, received_at: now.toISOString(), assistant_mode: mode, outcome: 'processing',
  });
  let calls = 0; let tin = 0; let tout = 0;
  let learned: Record<string, unknown> = {};

  const done = async (outcome: string, reason: string, patch: Record<string, unknown> = {}) => {
    const inbox = ['escalated', 'drafted', 'acknowledged', 'stopped'].includes(outcome) ? 'open' : 'none';
    const data = { outcome, reason, inbox_status: inbox, llm_calls: calls, est_tokens_in: tin, est_tokens_out: tout, ...learned, ...patch };
    await admin.entities.AssistantEvent.update(ev.id, data);
    ev = { ...ev, ...data };
    return ev;
  };
  const ask = async (prompt: string, schema: Record<string, unknown>) => {
    calls++; tin += estimateTokens(prompt);
    const out = await withTimeout(deps.llm({ prompt, schema }), MODEL_TIMEOUT_MS);
    tout += estimateTokens(JSON.stringify(out ?? ''));
    return out;
  };
  const replies24h = async () => (phone
    ? Number(await admin.entities.AssistantEvent.count({
      from_phone: phone, outcome: { $in: REPLY_OUTCOMES }, received_at: { $gte: new Date(now.getTime() - 24 * 3600_000).toISOString() },
    })) || 0
    : 0);

  try {
    // ── Loop and eligibility protection (before any model is paid for) ──────────
    if (phone && input.ownNumbers.includes(phone)) return await done('skipped', 'The message came from our own number.');
    if (client) {
      const prior = asList(await admin.entities.Message.filter({ client_id: client.id, direction: 'outgoing' }, '-created_date', 10));
      if (prior.some(m => String(m.message_text || '').trim() === input.body.trim())) {
        return await done('skipped', 'The text matches a message we sent, so it is treated as an echo.');
      }
    }
    if (input.clients.some(c => c.messaging_opted_out === true)) return await done('skipped', 'This client has opted out of messages.');
    if (input.clients.length > 0 && realClients.length === 0) return await done('skipped', 'Test data is never handled by the assistant.');
    if (!phone) return await done('escalated', 'The sender is not an Australian number the assistant can reply to.');

    const burst = Number(await admin.entities.AssistantEvent.count({
      from_phone: phone, received_at: { $gte: new Date(now.getTime() - BURST_WINDOW_MINUTES * 60_000).toISOString() },
    })) || 0;
    if (burst >= BURST_MESSAGES) return await done('escalated', `${burst} messages from this number in ${BURST_WINDOW_MINUTES} minutes — drafting stopped.`);

    // Booking conversations: only when wired in and the assistant is not off. A customer with an
    // open offer keeps talking to the flow; a new "what times do you have?" starts one.
    const bookingOn = !!deps.booking && mode !== 'off';
    const convo = bookingOn && client ? await loadActiveConversation(admin, client.id) : null;
    const inFlow = convo?.status === 'offered';
    const bookingTurn = bookingOn && (inFlow || isSlotQuestion(input.body));

    const screened = prescreen(input.body, input.numMedia || 0, { allowSlotQuestions: bookingTurn });
    if (screened) return await done('escalated', screened);
    if (realClients.length > 1) return await done('escalated', 'Several clients share this number, so the assistant will not guess who is writing.');

    // ── Facts ───────────────────────────────────────────────────────────────────
    const { pack, bookingId } = await buildContextPack(admin, client, now, settings?.campaign_booking_link || null);
    learned = { context_pack: pack, booking_request_id: bookingId || undefined };

    // A conversation that is actively in a booking flow needs more turns than a one-off question.
    const replyCap = inFlow ? BOOKING_REPLY_CAP : DAILY_REPLY_CAP;
    if ((await replies24h()) >= replyCap) return await done('escalated', `Daily assistant reply limit (${replyCap}) reached for this number.`);

    if (bookingTurn) {
      return await handleBookingTurn({
        admin, sid: input.sid, from: input.from, body: input.body, now, client, mode: mode as 'draft' | 'live', pack, convo,
        bookingLink: settings?.campaign_booking_link || null, booking: deps.booking!, enqueue: deps.enqueue, ask, done,
      });
    }

    // ── Classify ────────────────────────────────────────────────────────────────
    let cls;
    try {
      cls = normaliseClassification(await ask(classifyPrompt(pack, input.body), CLASSIFY_SCHEMA));
    } catch (e) {
      console.error('assistant classify failed', (e as Error)?.message);
      return await done('escalated', 'The assistant could not classify this message, so it is left for you.');
    }
    learned = { ...learned, classification: cls.classification, confidence: cls.confidence, request_type: cls.request_type, classifier_reason: cls.reason };

    if (cls.classification === 'escalate') return await done('escalated', cls.forced_escalation || cls.reason || 'Needs a person.');
    if (cls.classification === 'change_request') return await changeRequest(admin, deps, ev, input, client, pack, bookingId, cls.request_type, done, ask);

    // ── Answerable ──────────────────────────────────────────────────────────────
    if (mode === 'off') return await done('escalated', 'The assistant is off: a routine question for you to answer.');
    let draft = '';
    try {
      const out = await ask(draftPrompt(pack, input.body), DRAFT_SCHEMA);
      draft = typeof out?.reply === 'string' ? out.reply.trim() : '';
    } catch (e) {
      console.error('assistant draft failed', (e as Error)?.message);
      return await done('escalated', 'The assistant could not write a reply, so it is left for you.');
    }
    if (!draft) return await done('escalated', 'The context does not fully answer this, so it is left for you.');

    const verdict = guardDraft(draft, guardContextFor(pack, now));
    if (!verdict.ok) {
      console.log(JSON.stringify({ event: 'assistant_guard_fired', codes: verdict.codes }));
      return await done('stopped', `The guard stopped the draft: ${verdict.reasons.join('; ')}.`,
        { draft_text: draft, draft_status: 'discarded', guard_fired: true, guard_reasons: verdict.reasons });
    }
    if (!client) {
      return await done('escalated', 'New number with no client record, so a reply cannot be sent from here. The draft is attached to copy.',
        { draft_text: draft, draft_status: 'pending' });
    }
    if (mode === 'draft') return await done('drafted', 'Draft ready for you to send.', { draft_text: draft, draft_status: 'pending' });

    const queued = await deps.enqueue(admin, {
      channel: 'sms', to_address: phone, template_key: 'assistant_reply', payload: { text: draft, assistant_event_id: ev.id },
      client_id: client.id, booking_request_id: bookingId || undefined, idempotency_key: `sms|${client.id}|assistant_${input.sid}`,
    });
    if (!queued.ok) return await done('escalated', `The reply could not be queued: ${queued.error}`, { draft_text: draft, draft_status: 'pending' });
    return await done('queued', 'Answered automatically (live mode).',
      { draft_text: draft, draft_status: 'sent', sent_by: 'assistant', sent_at: now.toISOString(), send_kind: 'automated', outbox_id: queued.message_outbox?.id });
  } catch (e) {
    console.error('assistant failed', (e as Error)?.message);
    return await done('escalated', 'The assistant hit an error, so this is left for you.');
  }
}

/** Records the request and acknowledges it. The booking is only ever READ. */
async function changeRequest(
  admin: any, deps: FlowDeps, ev: any, input: FlowInput, client: any | null, pack: AssistantPack,
  bookingId: string | null, requestType: string, done: (o: string, r: string, p?: Record<string, unknown>) => Promise<any>,
  ask: (prompt: string, schema: Record<string, unknown>) => Promise<any>,
) {
  if (!client || !bookingId || !pack.next_booking) {
    return done('escalated', 'Looks like a change request, but there is no upcoming booking to attach it to.');
  }
  const now = input.now || new Date();
  let flag = asList(await admin.entities.BookingReplyFlag.filter({ provider_message_id: input.sid }, 'created_date', 1))[0];
  if (!flag) {
    // A reschedule of a booked time gets the engine's valid alternatives attached, so Alvaro picks
    // one with a tap. They are only attached: nothing here changes the booking.
    let suggested: unknown[] = [];
    const protectedBooking = ['confirmed', 'locked'].includes(pack.next_booking.schedule_status);
    if (deps.booking && protectedBooking && (requestType === 'time' || requestType === 'date')) {
      try {
        const booking = await admin.entities.BookingRequest.get(bookingId);
        suggested = await rescheduleOptions(admin, deps.booking, booking, ask, input.body, now);
      } catch { suggested = []; }
    }
    flag = await admin.entities.BookingReplyFlag.create({
      suggested_options: suggested,
      booking_request_id: bookingId, client_id: client.id, kind: 'needs_attention', reply_text: input.body,
      service_date: pack.next_booking.date, provider_message_id: input.sid, status: 'open', source: 'assistant',
      request_type: ['time', 'date', 'service', 'address', 'other'].includes(requestType) ? requestType : 'other',
      requested_at: now.toISOString(), booking_schedule_status: pack.next_booking.schedule_status || undefined,
    });
  }

  const ctx = guardContextFor(pack, now);
  let ack = acknowledgementText(pack.first_name);
  if (!guardDraft(ack, ctx).ok) ack = acknowledgementText(null);
  if (!guardDraft(ack, ctx).ok) {
    return done('escalated', 'Change request recorded, but no safe acknowledgement could be written.', { reply_flag_id: flag.id });
  }
  const phone = normaliseAuPhone(input.from)!;
  const queued = await deps.enqueue(admin, {
    channel: 'sms', to_address: phone, template_key: 'assistant_reply', payload: { text: ack, assistant_event_id: ev.id },
    client_id: client.id, booking_request_id: bookingId, idempotency_key: `sms|${client.id}|assistant_ack_${input.sid}`,
  });
  if (!queued.ok) {
    return done('escalated', `Change request recorded, but the acknowledgement could not be queued: ${queued.error}`, { reply_flag_id: flag.id });
  }
  return done('acknowledged', `Change request recorded (${requestType}). The booking was not changed; acknowledgement queued.`, {
    reply_flag_id: flag.id, draft_text: ack, draft_status: 'sent', sent_by: 'assistant', sent_at: now.toISOString(),
    send_kind: 'automated', outbox_id: queued.message_outbox?.id,
  });
}

/** Alvaro taps Send on a waiting draft. Re-checks the guard against the booking as it is NOW. */
export async function sendDraft(admin: any, eventId: string, who: string, deps: Pick<FlowDeps, 'enqueue'>, now: Date = new Date()) {
  let ev: any = null;
  try { ev = await admin.entities.AssistantEvent.get(eventId); } catch { ev = null; }
  if (!ev) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That draft no longer exists.' };
  if (ev.draft_status !== 'pending' || !ev.draft_text) return { ok: false, status: 409, code: 'NOT_PENDING', error: 'This draft has already been handled.' };
  if (!ev.client_id) return { ok: false, status: 422, code: 'NO_CLIENT', error: 'There is no client record for this number, so the draft cannot be sent from here. Copy it instead.' };

  let client: any = null;
  try { client = await admin.entities.ReminderClient.get(ev.client_id); } catch { client = null; }
  if (!client) return { ok: false, status: 404, code: 'NO_CLIENT', error: 'Client not found.' };
  if (client.messaging_opted_out === true) return { ok: false, status: 409, code: 'OPTED_OUT', error: 'This client has opted out of messages, so nothing can be sent.' };
  const to = normaliseAuPhone(client.phone);
  if (!to) return { ok: false, status: 422, code: 'NO_PHONE', error: 'This client has no valid Australian mobile number.' };

  const { pack, bookingId } = await buildContextPack(admin, client, now);
  // A booking-conversation message is checked against the slots the engine returned for it
  // (stored on the event), on top of the facts in the pack — and nothing else.
  const base = guardContextFor(pack, now);
  const ctx = {
    ...base,
    allowedMinutes: [...base.allowedMinutes, ...(ev.allowed_minutes || [])],
    days: { ...base.days, weekdays: [...base.days.weekdays, ...(ev.allowed_weekdays || [])] },
  };
  const verdict = guardDraft(ev.draft_text, ctx);
  if (!verdict.ok) {
    await admin.entities.AssistantEvent.update(ev.id, {
      draft_status: 'discarded', guard_fired: true, guard_reasons: verdict.reasons, outcome: 'stopped', inbox_status: 'open',
      reason: `The guard stopped this draft before sending: ${verdict.reasons.join('; ')}.`,
    });
    return { ok: false, status: 409, code: 'GUARD', error: 'The booking changed since this draft was written, so it was stopped. Write your own reply.' };
  }

  const queued = await deps.enqueue(admin, {
    channel: 'sms', to_address: to, template_key: 'assistant_reply', payload: { text: ev.draft_text, assistant_event_id: ev.id },
    client_id: client.id, booking_request_id: bookingId || ev.booking_request_id || undefined,
    idempotency_key: `sms|${client.id}|assistant_${ev.provider_message_id}`, manual: true,
  });
  if (!queued.ok) return { ok: false, status: queued.status, code: queued.code, error: queued.error };
  await admin.entities.AssistantEvent.update(ev.id, {
    draft_status: 'sent', sent_by: who, sent_at: now.toISOString(), send_kind: 'manual', outbox_id: queued.message_outbox?.id,
    inbox_status: 'resolved', resolved_by: who, resolved_at: now.toISOString(),
  });
  // A booking offer only reaches the customer when it is tapped: the 24-hour offer clock starts now.
  if (ev.conversation_id) {
    try {
      const convo = await admin.entities.AssistantConversation.get(ev.conversation_id);
      if (convo?.status === 'drafting') {
        await admin.entities.AssistantConversation.update(convo.id, {
          status: 'offered', offered_at: now.toISOString(),
          log: [...(convo.log || []), { at: now.toISOString(), step: 'sent', detail: `${who} sent the offer.` }],
        });
      }
    } catch { /* the message is already queued; the conversation record is only the log */ }
  }
  return { ok: true, outbox_id: queued.message_outbox?.id };
}