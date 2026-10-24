import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { statusCallbackUrl, verifyTwilioSignature } from '../../shared/twilio.ts';
import { targetFromProvider, deliveryUpdate, mergeRecorded } from '../../shared/deliveryStatus.ts';

/**
 * twilioStatusWebhook — PUBLIC endpoint Twilio calls as an SMS moves to
 * delivered / failed. It is the one deliberate exception to the admin-gate rule:
 * Twilio cannot sign in, so authenticity is proven by the X-Twilio-Signature
 * header instead. Anything that fails verification gets 401 and touches nothing.
 *
 * Repeat-safe: updates are conditional on the Message's current state, so a
 * duplicate or out-of-order callback never downgrades a message
 * (delivered is final).
 *
 * Race: the callback can arrive before the sweep has created the Message. The
 * outbox row already holds the provider id, so the result is recorded THERE
 * (provider_delivery_status) and the sweep applies it as soon as the Message
 * exists. A callback for an id that matches neither is answered 503, never 200,
 * so it is not silently treated as handled.
 */

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default async function (req: Request) {
  try {
    const authToken = String(secrets.get('TWILIO_AUTH_TOKEN') || '').trim();
    if (!authToken) return Response.json({ error: 'Not configured.' }, { status: 503 });

    const raw = await req.text();
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

    const ok = await verifyTwilioSignature(authToken, req.headers.get('x-twilio-signature'), [statusCallbackUrl(), req.url], params);
    if (!ok) return Response.json({ error: 'Invalid signature.' }, { status: 401 });

    const sid = params.MessageSid || params.SmsSid || '';
    if (!sid) return Response.json({ error: 'Missing MessageSid.' }, { status: 400 });

    const status = params.MessageStatus || params.SmsStatus || '';
    const target = targetFromProvider(status);
    // queued / sending / sent: nothing to change — the Message is already "sent".
    if (!target) return Response.json({ ok: true, ignored: status.toLowerCase() || 'unknown' });

    const admin = createClientFromRequest(req).asServiceRole;
    const findMessages = async () => asList(await admin.entities.Message.filter({ provider_message_id: sid }, 'created_date', 5));

    let rows = await findMessages();
    if (rows.length === 0) {
      await wait(1000);
      rows = await findMessages();
    }

    if (rows.length === 0) {
      const outbox = asList(await admin.entities.MessageOutbox.filter({ provider_message_id: sid }, 'created_date', 1))[0];
      if (!outbox) {
        console.warn(JSON.stringify({ event: 'status_callback_unmatched', status: target }));
        return Response.json({ ok: false, matched: false, retry: true }, { status: 503 });
      }
      // Keep the result on the outbox row; delivered always wins over failed.
      const keep = mergeRecorded(outbox.provider_delivery_status, target);
      await admin.entities.MessageOutbox.updateMany(
        { id: outbox.id },
        { $set: { provider_delivery_status: keep, provider_error_code: keep === 'failed' ? (params.ErrorCode || 'unknown') : null } },
      );
      // The Message may have been created while we were writing: apply it now if so.
      rows = await findMessages();
      if (rows.length === 0) return Response.json({ ok: true, matched: false, recorded: true, status: keep });
    }

    const upd = deliveryUpdate(target, params.ErrorCode);
    if (!upd) return Response.json({ ok: true, ignored: 'unknown' });
    for (const row of rows) {
      await admin.entities.Message.updateMany({ id: row.id, delivery_status: { $in: upd.from } }, { $set: upd.set });
    }
    return Response.json({ ok: true, matched: true, status: target });
  } catch (e) {
    console.error('twilioStatusWebhook failed', (e as Error)?.message);
    return Response.json({ error: 'Webhook failed.' }, { status: 500 });
  }
}