import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { firstName } from './bookingMessages.ts';
import { resolveCadence, cadencePatch } from './cadence.ts';
import { paymentOrLegacy } from './ensurePayment.ts';
import { balanceEligible, owedAfterService, queueLinkMessage } from './paymentMessages.ts';

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** Queues a customer message on the outbox. Never sends, never throws. */
export async function queueMessage(admin: any, booking: any, template: string, key: string, payload: Record<string, string>) {
  try {
    const to = normaliseAuPhone(booking?.phone) || String(booking?.phone || '').trim();
    if (!to) return { queued: false, reason: 'This booking has no phone number.' };
    const r = await enqueueOutboxMessage(admin, {
      channel: 'sms', to_address: to, template_key: template, payload,
      booking_request_id: booking.id, client_id: booking.client_id || undefined, idempotency_key: key,
    });
    return r.ok ? { queued: true, created: r.created } : { queued: false, reason: r.error };
  } catch (e) {
    console.error('route message enqueue failed', template, (e as Error)?.message);
    return { queued: false, reason: 'Could not queue the message.' };
  }
}

const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/**
 * The completion text. Given the booking's payment record it states what is ACTUALLY owing (a paid deposit is
 * taken off); without one it falls back to the booking's earlier Paid / Unpaid field and its full price.
 */
export function completionPayload(booking: any, payment?: any): Record<string, string> {
  const price = Number(booking.price) || 0;
  let payment_line: string;
  if (price <= 0) payment_line = 'Thanks again.';
  else if (payment) {
    const owing = owedAfterService(payment);
    payment_line = owing > 0 ? `Amount owing: ${money(owing)}.`
      : (payment.amount_paid || 0) - (payment.amount_refunded || 0) >= price - 0.001 ? `Paid ${money(price)}, thank you.` : 'Thanks again.';
  } else payment_line = booking.payment_status === 'Paid' ? `Paid ${money(price)}, thank you.` : `Amount owing: ${money(price)}.`;
  const service = (Array.isArray(booking.services) ? booking.services : []).filter(Boolean).join(', ') || 'haircut';
  return { name: firstName(booking.client_name), service, payment_line };
}

/**
 * Next reminder date = visit date + the cadence that wins (a person's choice, else a trusted
 * measurement, else the label; see shared/cadence). Null when they have no fixed gap.
 */
export function nextReminderFor(client: any, visit: string): string | null {
  const days = resolveCadence(client).days;
  if (!days || !/^\d{4}-\d{2}-\d{2}$/.test(visit)) return null;
  const d = new Date(`${visit}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Everything completing a stop does besides the stop itself. Every step is safe
 * to repeat: the message is keyed, and the booking and client are set to values.
 */
export async function finishCompletion(admin: any, booking: any, now: string) {
  if (booking.status !== 'completed') {
    await admin.entities.BookingRequest.update(booking.id, { status: 'completed', closed_date: now });
  }
  const visit = booking.requested_date || now.slice(0, 10);
  let client: any = null;
  if (booking.client_id) {
    try { client = await admin.entities.ReminderClient.get(booking.client_id); } catch { client = null; }
  } else if (booking.client_name) {
    const found = asList(await admin.entities.ReminderClient.filter({ client_name: booking.client_name }, '-created_date', 2));
    client = found.length === 1 ? found[0] : null;
  }
  let stamped = false;
  if (client) {
    const patch: Record<string, any> = { last_visit_date: visit, workflow_stage: 'none' };
    // Re-measure from completed visits (this one included). If that cannot be read, the stored cadence is used.
    let current = client;
    try {
      const done = asList(await admin.entities.BookingRequest.filter({ client_id: client.id, status: 'completed' }, { limit: 200 }));
      if (!done.some((b: any) => b.id === booking.id)) done.push({ ...booking, status: 'completed' });
      Object.assign(patch, cadencePatch(client, done, now).patch);
      current = { ...client, ...patch };
    } catch (e) { console.error('cadence recompute failed', (e as Error)?.message); }
    const next = nextReminderFor(current, visit);
    if (next) patch.next_reminder_date = next;
    await admin.entities.ReminderClient.update(client.id, patch);
    stamped = true;
  }
  // Any open follow-up for this booking is closed (the Schedule page used to do this alone; now both screens do).
  try {
    const items = asList(await admin.entities.WorkflowItem.filter({ booking_request_id: booking.id }, '-created_date', 20));
    for (const item of items) if (item.status !== 'completed') await admin.entities.WorkflowItem.update(item.id, { status: 'completed', closed_date: now, closed_reason: 'completed' });
  } catch (e) { console.error('workflow items not closed', (e as Error)?.message); }
  // What is owing comes from the payment record, so a paid deposit is not asked for twice.
  let payment: any = null;
  try { payment = await paymentOrLegacy(admin, booking); } catch (e) { console.error('payment record unavailable at completion', (e as Error)?.message); }
  const message = await queueMessage(admin, booking, 'booking_completed', `sms|${booking.id}|booking_completed`, completionPayload(booking, payment));
  // A balance still owing gets its own text with a payment link. A failure is flagged to an admin on the payment, never silent.
  const balance = balanceEligible(payment) ? await queueLinkMessage(admin, booking, 'balance', { actor: 'Route', automation: false }) : null;
  return {
    client_stamped: stamped, message_queued: message.queued === true, message_reason: (message as any).reason || null,
    balance_request: balance && { queued: balance.queued, already: balance.already === true, needs_attention: balance.needs_attention === true, reason: balance.reason || balance.skipped || null },
  };
}