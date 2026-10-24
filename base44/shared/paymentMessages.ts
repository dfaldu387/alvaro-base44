import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { firstName, friendlyDate } from './bookingMessages.ts';
import { amountOwing, toMoney } from './paymentState.ts';
import { issuePaymentLink, markAttention } from './paymentLink.ts';
import type { PaymentProvider } from './paymentProvider.ts';

/**
 * The three payment texts: the deposit request, the balance request and the receipt. Every one
 * goes on the outbox through enqueueOutboxMessage with an idempotency key, so the sweep applies
 * consent, STOP, quiet hours, messaging mode and test-data suppression exactly as for any other text.
 *
 * LINK ORDERING (deposit and balance): the link is made BEFORE the text is queued, so the text is
 * complete when it is queued and a failure queues nothing and raises an admin action. The link is then
 * checked AGAIN when the sweep is about to send (resolveLinkMessage): money no longer owing means no
 * text; a different amount or a link about to expire means a fresh link, never a stale one.
 */
export const LINK_TEMPLATES = ['deposit_request', 'balance_request'];
const BALANCE_STATES = ['not_required', 'deposit_paid', 'balance_due'];
const DEAD_BOOKING = ['declined', 'cancelled', 'no_show', 'could_not_fit', 'blocked'];
const RECEIPT_EVENTS = ['payment_received', 'provider_payment', 'provider_webhook_payment'];
const SETTLING_EVENTS = [...RECEIPT_EVENTS, 'deposit_waived', 'written_off'];

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const r2 = (n: number) => Math.round(n * 100) / 100;
const safeGet = async (admin: any, entity: string, id: string) => { try { return await admin.entities[entity].get(id); } catch { return null; } };

export async function paymentOf(admin: any, bookingId: string) {
  return asList(await admin.entities.BookingPayment.filter({ booking_request_id: bookingId }, '-created_date', 1))[0] || null;
}

/** A balance can be collected from these states while something is still owing. A deposit that is still unpaid is the open ask. */
export const balanceEligible = (payment: any) => !!payment && BALANCE_STATES.includes(payment.state) && amountOwing(toMoney(payment)) > 0;

/** What the customer owes once the service is done: the whole unpaid amount, even if the deposit was never paid. */
export const owedAfterService = (payment: any) =>
  amountOwing(toMoney({ ...payment, state: payment.state === 'deposit_due' ? 'balance_due' : payment.state }));

const expiryFmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
/** "Saturday 17 October, 5:30pm" on the Sydney clock. */
export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p: Record<string, string> = {};
  for (const part of expiryFmt.formatToParts(d)) p[part.type] = part.value;
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}${String(p.dayPeriod || '').toLowerCase()}`;
}

/** The reason a payment-link text must NOT go out for this payment right now, or null. Used when queued, when settled, and at send time. */
export function linkMessageBlock(template: string, payment: any, booking: any): string | null {
  if (booking && DEAD_BOOKING.includes(String(booking.status))) return `the booking is ${String(booking.status).replace(/_/g, ' ')}`;
  if (!payment) return 'there is no payment record for this booking';
  const owing = amountOwing(toMoney(payment));
  if (template === 'deposit_request') return payment.state === 'deposit_due' && owing > 0 ? null : 'the deposit is no longer owing';
  return BALANCE_STATES.includes(payment.state) && owing > 0 ? null : 'nothing is owing any more';
}

async function providerFor(ctx: { provider?: PaymentProvider }): Promise<PaymentProvider> {
  if (ctx.provider) return ctx.provider;
  return (await import('./paymentProvider.ts')).getPaymentProvider();
}
const loadRules = async (admin: any) => asList(await admin.entities.DepositRules.list('-created_date', 1))[0] || null;

function linkPayload(booking: any, link: { url: string; expiresAt: string; amount: number }) {
  return {
    name: firstName(booking.client_name),
    date: friendlyDate(booking.requested_date),
    service: (Array.isArray(booking.services) ? booking.services : []).filter(Boolean).join(', ') || 'haircut',
    amount: link.amount.toFixed(2),
    payment_link: link.url,
    expires: formatExpiry(link.expiresAt),
  };
}

export interface QueueResult { queued: boolean; already?: boolean; status?: string; skipped?: string; reason?: string; needs_attention?: boolean }
export interface LinkContext { provider?: PaymentProvider; rules?: any; actor?: string; automation?: boolean }

/**
 * Makes the link, then queues the deposit or balance text that carries it. Never throws.
 * If the link cannot be made, or the customer cannot be reached, NOTHING is queued and the payment is
 * flagged for an admin with a readable reason: a customer must never silently go un-asked.
 */
export async function queueLinkMessage(admin: any, booking: any, kind: 'deposit' | 'balance', ctx: LinkContext = {}): Promise<QueueResult> {
  try {
    if (booking.is_test === true) return { queued: false, skipped: 'This is a test booking, so no payment link is made.' };
    const template = kind === 'deposit' ? 'deposit_request' : 'balance_request';
    const key = `sms|${booking.id}|${template}`;
    const prior = asList(await admin.entities.MessageOutbox.filter({ idempotency_key: key }, 'created_date', 1))[0];
    if (prior) return { queued: false, already: true, status: String(prior.status) };

    const payment = await paymentOf(admin, booking.id);
    const block = linkMessageBlock(template, payment, booking);
    if (block) return { queued: false, skipped: `Nothing to send: ${block}.` };

    const attention = async (reason: string): Promise<QueueResult> => { await markAttention(admin, payment.id, reason); return { queued: false, reason, needs_attention: true }; };
    const to = normaliseAuPhone(booking.phone) || String(booking.phone || '').trim();
    if (!to) return attention('This booking has no phone number, so the payment link could not be texted. Add a number or collect the payment another way.');

    const link = await issuePaymentLink(admin, {
      paymentId: payment.id, provider: await providerFor(ctx), actor: ctx.actor || 'System', automation: ctx.automation !== false,
      rules: ctx.rules !== undefined ? ctx.rules : await loadRules(admin),
    });
    if (!link.ok) return attention(`The payment link could not be made, so the customer has not been asked for money. ${link.reason}`);

    const r = await enqueueOutboxMessage(admin, {
      channel: 'sms', to_address: to, template_key: template, payload: linkPayload(booking, link),
      booking_request_id: booking.id, idempotency_key: key,
    });
    if (!r.ok) return attention(`The payment text could not be queued: ${r.error}`);
    return { queued: true, already: !r.created };
  } catch (e) {
    console.error('queueLinkMessage failed', kind, (e as Error)?.message);
    return { queued: false, reason: 'Could not queue the payment link message.' };
  }
}

export type Resolved =
  | { action: 'send'; payload: Record<string, string> }
  | { action: 'suppress'; reason: string }
  | { action: 'retry'; reason: string }
  | { action: 'fail'; reason: string };

/**
 * The send-time check the sweep runs on a deposit or balance text, against the LIVE payment:
 * not owing any more -> suppress; otherwise the amount and link in the text are brought up to date.
 */
export async function resolveLinkMessage(admin: any, item: any, ctx: LinkContext = {}): Promise<Resolved> {
  const template = String(item.template_key);
  const booking = item.booking_request_id ? await safeGet(admin, 'BookingRequest', item.booking_request_id) : null;
  if (!booking) return { action: 'retry', reason: 'The booking could not be read.' };
  const payment = await paymentOf(admin, booking.id);
  const block = linkMessageBlock(template, payment, booking);
  if (block) return { action: 'suppress', reason: block };
  if (payment.is_test === true) return { action: 'suppress', reason: 'test data' };

  const link = await issuePaymentLink(admin, {
    paymentId: payment.id, provider: await providerFor(ctx), actor: 'Message sweep', automation: true,
    rules: ctx.rules !== undefined ? ctx.rules : await loadRules(admin),
  });
  if (!link.ok) {
    await markAttention(admin, payment.id, `The payment text was held back because its link could not be made. ${link.reason}`);
    return { action: link.retryable ? 'retry' : 'fail', reason: link.reason };
  }
  return { action: 'send', payload: { ...(item.payload || {}), ...linkPayload(booking, link) } };
}

/** Pending deposit / balance texts that are no longer owed are suppressed now, instead of waiting for the sweep to notice. */
export async function settlePendingLinkMessages(admin: any, bookingId: string): Promise<number> {
  const [booking, payment] = [await safeGet(admin, 'BookingRequest', bookingId), await paymentOf(admin, bookingId)];
  const rows = asList(await admin.entities.MessageOutbox.filter({ booking_request_id: bookingId, status: 'pending' }, 'created_date', 50))
    .filter((r: any) => LINK_TEMPLATES.includes(String(r.template_key)));
  let n = 0;
  for (const r of rows) {
    const why = linkMessageBlock(String(r.template_key), payment, booking);
    if (!why) continue;
    await admin.entities.MessageOutbox.updateMany(
      { id: r.id, status: 'pending' },
      { $set: { status: 'suppressed', suppressed_reason: why }, $push: { history: { at: new Date().toISOString(), result: 'suppressed', note: `Not sent: ${why}.` } } },
    );
    n++;
  }
  return n;
}

/** One receipt per payment: keyed on the PaymentEvent that recorded it, so a repeat delivery finds the first. */
export async function enqueueReceipt(admin: any, ev: any) {
  const booking = await safeGet(admin, 'BookingRequest', ev.booking_request_id);
  if (!booking) return { queued: false, reason: 'The booking could not be read.' };
  const amount = Number(ev.amount) || 0;
  if (!(amount > 0)) return { queued: false, reason: 'No amount to confirm.' };
  const to = normaliseAuPhone(booking.phone) || String(booking.phone || '').trim();
  if (!to) return { queued: false, reason: 'No phone number on the booking.' };
  const payment = await paymentOf(admin, booking.id);
  const remaining = payment ? Math.max(0, r2((payment.total_amount || 0) - (payment.amount_paid || 0))) : 0;
  const settled = ev.to_state === 'paid_in_full' || remaining <= 0;
  const remaining_line = settled ? 'Nothing further is owing.'
    : ev.to_state === 'deposit_paid' ? `The remaining $${remaining.toFixed(2)} is due after your service.` : `$${remaining.toFixed(2)} is still owing.`;
  const r = await enqueueOutboxMessage(admin, {
    channel: 'sms', to_address: to, template_key: 'payment_receipt',
    payload: {
      name: firstName(booking.client_name), purpose: ev.to_state === 'deposit_paid' ? 'deposit' : 'payment', amount: amount.toFixed(2),
      service: (Array.isArray(booking.services) ? booking.services : []).filter(Boolean).join(', ') || 'haircut', remaining_line,
    },
    booking_request_id: booking.id, idempotency_key: `sms|${booking.id}|payment_receipt|${ev.id}`,
  });
  return r.ok ? { queued: true, created: r.created } : { queued: false, reason: r.error };
}

/**
 * What follows a recorded payment event: stop texts that are no longer owed, and send the receipt for
 * money that really arrived. Driven by the PaymentEvent row, so the webhook, the admin and the barber all
 * lead here and the webhook itself never has to message anyone.
 */
export async function handlePaymentEvent(admin: any, eventId: string) {
  const ev = await safeGet(admin, 'PaymentEvent', eventId);
  if (!ev) return { handled: false, reason: 'event not found' };
  if (!SETTLING_EVENTS.includes(String(ev.event_type))) return { handled: false, reason: 'not an event that settles money' };
  const settled = await settlePendingLinkMessages(admin, ev.booking_request_id);
  if (!RECEIPT_EVENTS.includes(String(ev.event_type))) return { handled: true, settled, receipt: null };
  if (ev.is_simulated === true) return { handled: true, settled, receipt: { queued: false, reason: 'A simulated payment moved no money, so no receipt is sent.' } };
  return { handled: true, settled, receipt: await enqueueReceipt(admin, ev) };
}