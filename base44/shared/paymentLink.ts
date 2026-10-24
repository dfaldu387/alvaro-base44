import { amountOwing, canRequestLink, toMoney, testDataRefusal } from './paymentState.ts';
import { claimIntent, settleIntent, markIntentUnknown, releaseIntent } from './paymentIntent.ts';
import { recordAudit, finishAudit } from './auditLog.ts';
import type { PaymentProvider } from './paymentProvider.ts';

/**
 * Makes (or reuses) the payment link for what a booking owes RIGHT NOW. Every Square call goes
 * through the claim in paymentIntent.ts: the key sent to Square is built from the claimed
 * operation, so a retry, a second tap or a second run can never create a second order.
 *
 * Used by the deposit text, the balance text and the send-time check in the sweep. The admin's
 * own "Request payment link" button (paymentAction) is unchanged and uses the same claim.
 */
/** A link with less life than this left is not put in a text; a fresh one is made first. */
export const MIN_LINK_LIFE_MS = 6 * 3600_000;

export type LinkResult =
  | { ok: true; url: string; expiresAt: string; amount: number; reused: boolean }
  | { ok: false; reason: string; retryable: boolean };

const fail = (reason: string, retryable: boolean): LinkResult => ({ ok: false, reason, retryable });
const isSimulatedId = (id: unknown) => String(id || '').startsWith('SIMULATED');

/** Raises the admin-action flag on a payment. Never throws. */
export async function markAttention(admin: any, paymentId: string, reason: string) {
  try {
    await admin.entities.BookingPayment.update(paymentId, { needs_attention: true, attention_reason: String(reason).slice(0, 300), attention_at: new Date().toISOString() });
  } catch (e) { console.error('markAttention failed', (e as Error)?.message); }
}

export async function issuePaymentLink(
  admin: any,
  p: { paymentId: string; provider: PaymentProvider; actor: string; automation?: boolean; rules?: any; now?: number },
): Promise<LinkResult> {
  const now = p.now ?? Date.now();
  let payment: any = null;
  try { payment = await admin.entities.BookingPayment.get(p.paymentId); } catch { payment = null; }
  if (!payment) return fail('There is no payment record for this booking.', false);

  // Test data never reaches real money — the same rule the refund path applies. A live
  // provider refuses a test booking outright; sandbox stays available so QA can still run.
  const testRefusal = testDataRefusal(p.provider.live === true, payment.is_test === true);
  if (testRefusal) return fail(testRefusal, false);

  const cur = toMoney(payment);
  const can = canRequestLink(cur);
  if (!can.ok) return fail(can.error, false);
  const owing = amountOwing(cur);

  // A link already made for exactly this amount, with enough life left, is used as it is.
  const life = Date.parse(payment.payment_link_expires_at || '') - now;
  if (payment.payment_link_url && !isSimulatedId(payment.provider_payment_id) && Number(payment.payment_link_amount) === owing && life >= MIN_LINK_LIFE_MS) {
    return { ok: true, url: String(payment.payment_link_url), expiresAt: String(payment.payment_link_expires_at), amount: owing, reused: true };
  }
  // A simulated link is never put in a customer's text: it points nowhere and moves no money.
  if (p.provider.simulated) return fail('Square is not switched on yet, so a real payment link cannot be made. Simulated links are never sent to customers.', false);

  // A claim left by an earlier run that got no answer from Square is retried with the SAME key.
  const seq = Number(payment.op_seq) || 0;
  const expectedSeq = payment.intent_key ? seq - 1 : seq;
  const c = await claimIntent(admin, payment, { kind: 'link', params: { amount: owing }, expectedSeq });
  if (!c.ok) return fail(c.error, c.status === 409);

  const auditBase = {
    action: 'payment_request_link', who: p.actor, automation: p.automation === true, summary: 'Payment: payment link made for a customer text',
    ids: { booking_request_id: payment.booking_request_id, payment_id: payment.id }, related: { type: 'BookingRequest' as const, id: payment.booking_request_id },
  };
  const logId = await recordAudit(admin, { ...auditBase, note: `State was ${cur.state}` });
  if (!logId) { await releaseIntent(admin, payment.id, c.key); return fail('The activity log could not be written, so no link was made.', true); }

  const hours = Number(p.rules?.link_expiry_hours) > 0 ? Number(p.rules.link_expiry_hours) : 24;
  let link: any;
  try {
    link = await p.provider.createPaymentLink({
      bookingId: payment.booking_request_id, amount: owing, currency: payment.currency || 'AUD',
      description: cur.state === 'deposit_due' && cur.amount_refunded <= 0 ? 'Deposit' : 'Balance', expiresInHours: hours, idempotencyKey: c.key,
    });
  } catch (e: any) {
    if (e?.definite === true) await releaseIntent(admin, payment.id, c.key);
    else await markIntentUnknown(admin, payment.id, c.key);
    return fail(`${e?.message || 'Square did not answer.'}`, e?.definite !== true);
  }

  const replaced = payment.provider_payment_id && payment.provider_payment_id !== link.providerPaymentId ? String(payment.provider_payment_id) : null;
  const saved = await settleIntent(admin, payment.id, c.key, {
    payment_provider: link.providerName, provider_payment_id: link.providerPaymentId,
    payment_link_url: link.url, payment_link_expires_at: link.expiresAt, payment_link_amount: owing,
    ...(replaced ? { replaced_provider_payment_ids: [...(payment.replaced_provider_payment_ids || []), replaced] } : {}),
    needs_attention: false, attention_reason: '', updated_by: p.actor,
  });
  if (!saved) return fail('Square made the link, but the payment record could not be updated.', true);

  await finishAudit(admin, logId, { ...auditBase, note: `${cur.state}: link for $${owing.toFixed(2)}`, counts: { amount: owing } });
  await admin.entities.PaymentEvent.create({
    booking_request_id: payment.booking_request_id, event_type: 'link_requested', from_state: cur.state, to_state: cur.state, amount: owing,
    actor: p.actor, note: `${link.wouldHaveDone} Made for a customer text.${replaced ? ` Replaced the earlier link (${replaced}).` : ''}`, is_simulated: link.simulated === true, is_test: payment.is_test === true,
  });
  return { ok: true, url: link.url, expiresAt: link.expiresAt, amount: owing, reused: false };
}