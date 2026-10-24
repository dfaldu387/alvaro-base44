import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { inboundUrl, verifyTwilioSignature } from '../../shared/twilio.ts';
import { classifyReply, findClientsByPhone, findPendingOutboxByPhone } from '../../shared/messagingProtections.ts';
import { classifyArrivalReply, recordArrivalReply } from '../../shared/arrivalReplies.ts';
import { confirmOverrideFromReply } from '../../shared/overrideReply.ts';
import { normaliseAuPhone } from '../../shared/auPhone.ts';
import { enqueueOutboxMessage } from '../../shared/outboxEnqueue.ts';
import { handleInbound } from '../../shared/assistantFlow.ts';
import { liveBookingDeps } from '../../shared/assistantBookingLive.ts';
import type { Llm } from '../../shared/assistantAi.ts';

/**
 * twilioInboundWebhook — PUBLIC endpoint Twilio calls when a customer replies.
 * Like twilioStatusWebhook it is a deliberate exception to the admin-gate rule:
 * Twilio cannot sign in, so authenticity is the X-Twilio-Signature header. A bad
 * or missing signature gets 401 and nothing is read or written.
 *
 * It never replies in the HTTP response (always an empty TwiML document). Any
 * reply to a free-text message is made by the AI assistant (shared/assistantFlow),
 * and only ever by putting a row on the MessageOutbox for the sweep to send.
 * Every step is repeat-safe, and the Message is written LAST, so a Twilio retry
 * after a partial failure re-applies the opt-out/in and then stores the message
 * exactly once (de-duplicated on MessageSid).
 */

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () => new Response(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });
const entry = (result: string, note: string) => ({ at: new Date().toISOString(), result, note });
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** Real clients first (a reply is never filed under a test client when a real one exists), oldest first. */
function pickClient(clients: any[]) {
  return [...clients].sort((a, b) => {
    if ((a.is_test === true) !== (b.is_test === true)) return a.is_test === true ? 1 : -1;
    return String(a.created_date || '') < String(b.created_date || '') ? -1 : 1;
  })[0] || null;
}

export default async function (req: Request) {
  try {
    const authToken = String(secrets.get('TWILIO_AUTH_TOKEN') || '').trim();
    if (!authToken) return Response.json({ error: 'Not configured.' }, { status: 503 });

    const raw = await req.text();
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

    const ok = await verifyTwilioSignature(authToken, req.headers.get('x-twilio-signature'), [inboundUrl(), req.url], params);
    if (!ok) return Response.json({ error: 'Invalid signature.' }, { status: 401 });

    const sid = params.MessageSid || params.SmsSid || '';
    const from = params.From || '';
    const body = params.Body ?? '';
    if (!sid || !from) return Response.json({ error: 'Missing MessageSid or From.' }, { status: 400 });

    const admin = createClientFromRequest(req).asServiceRole;

    const already = asList(await admin.entities.Message.filter({ provider_message_id: sid, direction: 'incoming' }, 'created_date', 1));
    if (already.length > 0) return twiml();

    const kind = classifyReply(body);
    const clients = await findClientsByPhone(admin, from);
    let suppressed = 0;

    if (kind === 'opt_out') {
      const now = new Date().toISOString();
      // Every client sharing this number is opted out (a household phone, a test twin).
      for (const c of clients) {
        if (c.messaging_opted_out === true) continue;
        await admin.entities.ReminderClient.update(c.id, { messaging_opted_out: true, opt_out_source: 'sms_reply', opted_out_at: now });
      }
      // Queued messages to this number are stopped at once, matched or not.
      for (const row of await findPendingOutboxByPhone(admin, from)) {
        const res = await admin.entities.MessageOutbox.updateMany(
          { id: row.id, status: 'pending' },
          { $set: { status: 'suppressed', suppressed_reason: 'opted out' }, $push: { history: entry('suppressed', 'Recipient replied STOP — opted out.') } },
        );
        if (res === undefined || res === null || res.modified_count !== 0) suppressed++;
      }
    } else if (kind === 'opt_in') {
      for (const c of clients) {
        if (c.messaging_opted_out !== true) continue;
        await admin.entities.ReminderClient.update(c.id, { messaging_opted_out: false, opted_out_at: null, opt_out_source: null });
      }
    }

    // The reply is stored for a human. Message needs a client, so a number that
    // matches nobody is logged (without the number or text) and not stored.
    const client = pickClient(clients);

    // Replies to the arrival-time message: YES confirms, NO / CANCEL / RESCHEDULE
    // flags the booking for a human (the booking itself is never changed), and a
    // reply that fits no single booking goes to the review list. No auto-reply.
    // CANCEL is NOT an opt-out keyword: it only flags the booking for a human.
    // Messaging opt-out is STOP / STOPALL / UNSUBSCRIBE / END / QUIT.
    const arrivalKind = classifyArrivalReply(body);
    let replyBookingId: string | null = null;
    let replyOutcome = 'none';
    if (arrivalKind !== 'other' || (kind === 'other' && clients.length === 0)) {
      const r = await recordArrivalReply(admin, { kind: arrivalKind, clients, primaryClientId: client?.id || null, from, body, sid });
      replyBookingId = r.bookingId;
      replyOutcome = r.outcome;
      // A YES to "we can fit you at ..." confirms the time we offered outside the
      // customer's availability. A NO is only ever a flag for a person: the booking
      // is never cancelled or moved by a reply (see overrideReply / recordArrivalReply).
      if (r.outcome === 'customer_confirmed' && r.bookingId) {
        try {
          if (await confirmOverrideFromReply(admin, r.bookingId)) replyOutcome = 'customer_confirmed_override';
        } catch (e) {
          console.error('override confirmation from reply failed', (e as Error)?.message);
        }
      }
    }

    if (client) {
      await admin.entities.Message.create({
        client_id: client.id,
        booking_request_id: replyBookingId || undefined,
        direction: 'incoming',
        message_type: 'sms',
        message_text: body,
        delivery_status: 'received',
        received_date: new Date().toISOString(),
        provider_message_id: sid,
      });
    }
    // The AI assistant sees ONLY what the keyword classifiers above did not claim
    // (not STOP/START, not YES/NO/CANCEL/RESCHEDULE). It never throws into the webhook:
    // a failure here must not make Twilio retry a message that is already stored.
    let assistantOutcome = 'not_applicable';
    if (kind === 'other' && arrivalKind === 'other') {
      try {
        const own = [params.To, secrets.get('TWILIO_FROM_NUMBER')].map(n => normaliseAuPhone(n)).filter((n): n is string => !!n);
        const llm: Llm = ({ prompt, schema }) => admin.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema });
        const ev = await handleInbound(admin, {
          sid, from, body, numMedia: Number(params.NumMedia || 0) || 0, clients, ownNumbers: own,
        }, { llm, enqueue: enqueueOutboxMessage, booking: liveBookingDeps });
        assistantOutcome = ev?.outcome || 'unknown';
      } catch (e) {
        assistantOutcome = 'error';
        console.error('assistant step failed', (e as Error)?.message);
      }
    }
    console.log(JSON.stringify({ event: 'sms_inbound', assistant: assistantOutcome, kind, clients_matched: clients.length, stored: !!client, outbox_suppressed: suppressed, arrival_reply: replyOutcome }));
    return twiml();
  } catch (e) {
    console.error('twilioInboundWebhook failed', (e as Error)?.message);
    return Response.json({ error: 'Webhook failed.' }, { status: 500 });
  }
}