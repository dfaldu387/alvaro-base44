/**
 * The payment INTENT: the claim written before an irreversible provider call.
 *
 * The same two-phase idea as the audit log (record the intent first, then act), applied to
 * Square. The claim lives on the BookingPayment row itself because the entity layer has no
 * unique constraint: only a conditional write on that one row can guarantee that two taps
 * produce one claim.
 *
 *  - The claim is ONE conditional write. It succeeds only if nobody holds a claim and the
 *    payment is exactly as the caller saw it (same state, amounts, provider id and op_seq).
 *    A second tap, a webhook that changed the payment, or a stale page all fail the condition.
 *  - The key sent to Square is built from the claim: payment id + kind + op_seq. Never random,
 *    never a timestamp. A retry of the same intention carries the same key; a new decision
 *    (a later partial refund, a replacement link) is made from a fresh view of the payment,
 *    so it carries a higher op_seq and therefore a different key.
 *  - "The same tap twice" versus "a new decision" is decided by the op_seq the page was looking
 *    at (expected_op_seq). The second of two identical taps still carries the old value, which
 *    no longer matches, so it is refused. A new decision is made after the page reloaded.
 */

/** A claim whose run stopped part-way is retryable after this long. Never used to tell requests apart. */
export const STALE_CLAIM_MS = 5 * 60_000;

export type IntentKind = 'link' | 'refund';
export type ClaimResult = { ok: true; key: string; replay: boolean } | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): ClaimResult => ({ ok: false, status, error });

/** The key Square sees: deterministic from the payment, the kind of operation and its sequence number. */
export const intentKeyFor = (paymentId: string, kind: IntentKind, seq: number) => `cd-${kind}-${paymentId}-${seq}`;

/** A value that may be missing on an older row, as a query condition. */
const orMissing = (v: any, empty: any) => (v === undefined || v === null || v === empty ? { $in: [empty, null] } : v);

const CLEARED = { intent_key: null, intent_kind: null, intent_params: null, intent_status: null, intent_at: null, intent_claim: null };

export async function claimIntent(
  admin: any,
  payment: any,
  p: { kind: IntentKind; params: Record<string, unknown>; expectedSeq: unknown },
): Promise<ClaimResult> {
  const seq = Number(payment.op_seq) || 0;
  const expected = Number(p.expectedSeq);
  if (p.expectedSeq === undefined || p.expectedSeq === null || p.expectedSeq === '' || !Number.isInteger(expected) || expected < 0) {
    return refuse(400, 'Reload the page before making this payment change.');
  }
  const params = JSON.stringify(p.params);

  if (payment.intent_key) {
    const sameIntention = payment.intent_kind === p.kind && payment.intent_params === params && expected === seq - 1;
    const age = Date.now() - (Date.parse(payment.intent_at || '') || 0);
    const retryable = payment.intent_status === 'unknown' || age > STALE_CLAIM_MS;
    // The same request, retried after Square gave no clear answer: it carries the SAME key.
    if (sameIntention && retryable) return { ok: true, key: String(payment.intent_key), replay: true };
    return refuse(409, 'Another payment change for this booking is still being confirmed with Square. Wait a moment, refresh, then check before trying again.');
  }
  if (expected !== seq) {
    return refuse(409, 'This payment has already changed since you opened it, so nothing was sent to Square. Refresh and check before trying again.');
  }

  const next = seq + 1;
  const key = intentKeyFor(String(payment.id), p.kind, next);
  const claim = crypto.randomUUID(); // ownership marker only; it is never sent to Square
  await admin.entities.BookingPayment.updateMany(
    {
      id: payment.id,
      intent_key: null,
      op_seq: orMissing(seq, 0),
      state: payment.state,
      amount_paid: orMissing(Number(payment.amount_paid) || 0, 0),
      amount_refunded: orMissing(Number(payment.amount_refunded) || 0, 0),
      provider_payment_id: orMissing(payment.provider_payment_id || '', ''),
    },
    { $set: { intent_key: key, intent_kind: p.kind, intent_params: params, intent_status: 'in_flight', intent_at: new Date().toISOString(), intent_claim: claim, op_seq: next } },
  );
  // Only the write that met the condition left its marker behind.
  const row = await admin.entities.BookingPayment.get(payment.id);
  if (!row || row.intent_claim !== claim) {
    return refuse(409, 'This payment changed at the same moment, so nothing was sent to Square. Refresh and check before trying again.');
  }
  return { ok: true, key, replay: false };
}

/** The one final write: applies the outcome and clears the claim together. Null if the claim is no longer ours. */
export async function settleIntent(admin: any, paymentId: string, key: string, fields: Record<string, any>) {
  await admin.entities.BookingPayment.updateMany({ id: paymentId, intent_key: key }, { $set: { ...fields, ...CLEARED } });
  const row = await admin.entities.BookingPayment.get(paymentId);
  return row && row.intent_key !== key ? row : null;
}

/** Square gave no clear answer: keep the claim so the same request can be retried with the same key. */
export async function markIntentUnknown(admin: any, paymentId: string, key: string) {
  try { await admin.entities.BookingPayment.updateMany({ id: paymentId, intent_key: key }, { $set: { intent_status: 'unknown' } }); } catch { /* the claim stays in flight and becomes retryable after STALE_CLAIM_MS */ }
}

/** Nothing reached Square (or Square clearly refused): drop the claim. op_seq stays, so the old page cannot repeat it. */
export async function releaseIntent(admin: any, paymentId: string, key: string) {
  try { await admin.entities.BookingPayment.updateMany({ id: paymentId, intent_key: key }, { $set: CLEARED }); } catch { /* retryable after STALE_CLAIM_MS */ }
}