import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { enqueueOutboxMessage } from '../../shared/outboxEnqueue.ts';
import { normaliseAuPhone } from '../../shared/auPhone.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

/**
 * sendManualMessage — an admin types a message to a client from the Messages page.
 *
 * It ONLY puts the message on the MessageOutbox (is_manual = true). The same
 * sweep that handles automated messages then applies test-data suppression and
 * opt-out, skips quiet hours (the manual-send exemption), sends through the
 * provider adapter and writes the Message row (manual_or_automated = "manual").
 * Nothing is sent from the browser or from this function.
 *
 * body: { client_id: string, text: string }
 * Admin-gated. The recipient number always comes from the client record, never
 * from the request.
 */
const MAX_LENGTH = 640;

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!clientId) return Response.json({ error: 'client_id is required.' }, { status: 400 });
    if (!text) return Response.json({ error: 'Type a message first.' }, { status: 400 });
    if (text.length > MAX_LENGTH) return Response.json({ error: `Messages are limited to ${MAX_LENGTH} characters.` }, { status: 400 });

    const admin = base44.asServiceRole;
    let client: any = null;
    try { client = await admin.entities.ReminderClient.get(clientId); } catch { client = null; }
    if (!client) return Response.json({ error: 'Client not found.' }, { status: 404 });

    if (client.messaging_opted_out === true) {
      return Response.json({ error: 'This client has opted out of messages, so nothing can be sent. Use the copy option instead.', code: 'OPTED_OUT' }, { status: 409 });
    }
    const to = normaliseAuPhone(client.phone);
    if (!to) return Response.json({ error: 'This client has no valid Australian mobile number.', code: 'NO_PHONE' }, { status: 422 });

    // The outbox row says nothing about who queued it, so the activity-log row is the only
    // record of the person. It is written FIRST; if it cannot be written, nothing is queued.
    // Who queued a message, to which client record, and how long it was. Never the number or the text.
    const auditBase = {
      action: 'manual_message_queued', who: actor.name, summary: 'A manual message was queued for a client',
      counts: { characters: text.length }, related: { type: 'Client' as const, id: client.id },
    };
    const logId = await recordAudit(admin, { ...auditBase, ids: { client_id: client.id } });
    if (!logId) return Response.json(AUDIT_REFUSED, { status: 500 });

    const result = await enqueueOutboxMessage(admin, {
      channel: 'sms',
      to_address: to,
      template_key: 'manual_message',
      payload: { text },
      client_id: client.id,
      idempotency_key: `sms|${client.id}|manual_${crypto.randomUUID()}`,
      manual: true,
    });
    if (!result.ok) {
      await finishAudit(admin, logId, { ...auditBase, ids: { client_id: client.id }, outcome: 'aborted', note: 'Nothing was queued.' });
      return Response.json({ error: result.error, code: result.code }, { status: result.status });
    }

    const row = result.message_outbox;
    await finishAudit(admin, logId, { ...auditBase, ids: { client_id: client.id, outbox_id: row.id } });
    return Response.json({
      ok: true,
      outbox_id: row.id,
      status: row.status,
      // Test clients are queued so the pipeline can be exercised, then suppressed by the sweep.
      will_be_suppressed: row.is_test === true,
    });
  } catch (_error) {
    return Response.json({ error: 'Could not queue the message.' }, { status: 500 });
  }
}