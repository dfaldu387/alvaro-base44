import type { PaymentProvider, PaymentLinkRequest, RefundRequest } from './paymentProvider.ts';
import type { SquareConfig } from './squareConfig.ts';

/**
 * Square adapter behind the existing PaymentProvider seam: payment link, payment status, refund.
 * Nothing else. It is only ever built by getPaymentProvider() after the full gate has passed.
 *
 * The booking is named on the link through the order's reference_id. Square echoes the ORDER id on
 * every payment and refund event, so the order id is what is stored as the provider payment id and
 * what the webhook matches on; once a payment completes the webhook replaces it with the real
 * Square payment id (which refunds need).
 */
const cents = (dollars: number) => Math.round(Number(dollars) * 100);
const isSimulatedId = (id: string) => String(id || '').startsWith('SIMULATED');

async function call(cfg: SquareConfig, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * An error says whether Square clearly refused (`definite`: nothing happened, the claim can be dropped)
 * or gave no clear answer (a timeout, a 5xx: it may have acted, so the same request must be retried
 * with the same key). Anything thrown before Square was asked is also definite.
 */
const definite = (error: Error) => Object.assign(error, { definite: true });

function failure(what: string, r: { status: number; json: any }) {
  const code = r.json?.errors?.[0]?.code;
  const refused = r.status >= 400 && r.status < 500 && ![408, 409, 429].includes(r.status);
  return Object.assign(new Error(`Square could not ${what} (HTTP ${r.status}${code ? `, ${code}` : ''}).`), { definite: refused });
}

function needKey(req: { idempotencyKey?: string }) {
  if (!req.idempotencyKey) throw definite(new Error('A Square request needs an operation key.'));
  return req.idempotencyKey;
}

export function createSquareProvider(cfg: SquareConfig): PaymentProvider {
  return {
    name: 'square',
    simulated: false,
    // Sandbox runs the same adapter against a fake bank: real code path, no real money.
    live: cfg.environment === 'production',

    async createPaymentLink(req: PaymentLinkRequest) {
      const amount = cents(req.amount);
      if (!(amount > 0)) throw definite(new Error('A payment link needs an amount greater than $0.'));
      const key = needKey(req);
      const r = await call(cfg, 'POST', '/v2/online-checkout/payment-links', {
        idempotency_key: req.idempotencyKey,
        order: {
          location_id: cfg.locationId,
          reference_id: req.bookingId,
          line_items: [{ name: req.description, quantity: '1', base_price_money: { amount, currency: req.currency } }],
        },
      });
      const link = r.json?.payment_link;
      if (!r.ok || !link?.order_id || !link?.url) throw failure('create the payment link', r);
      return {
        providerName: 'square',
        simulated: false,
        providerPaymentId: String(link.order_id),
        url: String(link.url),
        expiresAt: new Date(Date.now() + Math.max(1, req.expiresInHours) * 3600_000).toISOString(),
        wouldHaveDone: `Square payment link created for ${req.currency} ${req.amount.toFixed(2)} (${req.description}). The expiry shown is tracked by this app.`,
      };
    },

    async fetchPaymentStatus(providerPaymentId: string) {
      const base = { providerName: 'square', simulated: false, amountPaid: 0 };
      if (isSimulatedId(providerPaymentId)) return { ...base, status: 'unknown' as const, wouldHaveDone: 'This id came from the test double; Square was not asked.' };
      const r = await call(cfg, 'GET', `/v2/payments/${encodeURIComponent(providerPaymentId)}`);
      // Before a customer pays, the stored id is the order id, which is not a payment: nothing to report yet.
      if (r.status === 404) return { ...base, status: 'unknown' as const, wouldHaveDone: 'Square has no payment with this id yet.' };
      const p = r.json?.payment;
      if (!r.ok || !p) throw failure('read the payment', r);
      const status = p.status === 'COMPLETED' ? 'paid' : p.status === 'APPROVED' || p.status === 'PENDING' ? 'pending' : 'unknown';
      return {
        ...base,
        status: status as 'paid' | 'pending' | 'unknown',
        amountPaid: status === 'paid' ? Number(p.amount_money?.amount || 0) / 100 : 0,
        wouldHaveDone: `Asked Square about the payment: ${String(p.status || 'unknown').toLowerCase()}.`,
      };
    },

    async refund(req: RefundRequest) {
      if (isSimulatedId(req.providerPaymentId)) throw definite(new Error('This payment came from the test double, so it cannot be refunded through Square.'));
      if (!req.providerPaymentId) throw definite(new Error('There is no Square payment to refund yet.'));
      const key = needKey(req);
      const r = await call(cfg, 'POST', '/v2/refunds', {
        idempotency_key: req.idempotencyKey,
        payment_id: req.providerPaymentId,
        amount_money: { amount: cents(req.amount), currency: req.currency },
        reason: String(req.reason || '').slice(0, 190),
      });
      const refund = r.json?.refund;
      if (!r.ok || !refund?.id) throw failure('create the refund', r);
      if (refund.status !== 'COMPLETED' && refund.status !== 'PENDING') throw definite(new Error(`Square did not accept the refund (${String(refund.status || 'unknown').toLowerCase()}).`));
      return {
        providerName: 'square',
        simulated: false,
        status: refund.status === 'COMPLETED' ? ('succeeded' as const) : ('pending' as const),
        providerRefundId: String(refund.id),
        wouldHaveDone: `Square refund of ${req.currency} ${req.amount.toFixed(2)} ${refund.status === 'COMPLETED' ? 'completed' : 'is pending'}.`,
      };
    },
  };
}