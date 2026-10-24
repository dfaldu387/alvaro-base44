/**
 * The one internal payment-provider seam. Everything else in the system talks to
 * this interface; connecting Square later means writing one adapter that
 * implements it and returning it from getPaymentProvider().
 *
 * The test double is the default; Square is returned only through the gate in getPaymentProvider().
 */
import { secrets } from 'base44:runtime';
import { readSquareConfig, type SecretReader } from './squareConfig.ts';
import { createSquareProvider } from './squareProvider.ts';

export interface PaymentLinkRequest {
  bookingId: string;
  amount: number;
  currency: string;
  description: string;
  expiresInHours: number;
  /** Built from the claimed operation (shared/paymentIntent), never random: a retry carries the same key. */
  idempotencyKey: string;
}
export interface PaymentLinkResult {
  providerName: string;
  simulated: boolean;
  providerPaymentId: string;
  url: string;
  expiresAt: string;
  wouldHaveDone: string;
}
export interface PaymentStatusResult {
  providerName: string;
  simulated: boolean;
  status: 'pending' | 'paid' | 'expired' | 'unknown';
  amountPaid: number;
  wouldHaveDone: string;
}
export interface RefundRequest {
  providerPaymentId: string;
  amount: number;
  currency: string;
  reason: string;
  /** Built from the claimed operation (shared/paymentIntent), never random: a retry carries the same key. */
  idempotencyKey: string;
}
export interface RefundResult {
  providerName: string;
  simulated: boolean;
  status: 'succeeded' | 'pending';
  providerRefundId: string;
  wouldHaveDone: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly simulated: boolean;
  /**
   * True only when a call to this provider moves REAL money. Square sandbox is not
   * simulated — it is the real adapter against a fake bank — so `simulated` cannot
   * answer "would this charge someone". This can.
   */
  readonly live: boolean;
  createPaymentLink(req: PaymentLinkRequest): Promise<PaymentLinkResult>;
  /** `hint.simulatePaidAmount` is honoured by the test double only. */
  fetchPaymentStatus(providerPaymentId: string, hint?: { simulatePaidAmount?: number }): Promise<PaymentStatusResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
}

/**
 * Test double. Calls nothing, moves no money, and records what a real provider
 * would have done. Its links point at an obviously fake address and every id is
 * prefixed SIMULATED so it can never be mistaken for a real payment.
 */
export const testDoubleProvider: PaymentProvider = {
  name: 'test_double',
  simulated: true,
  live: false,
  async createPaymentLink(req) {
    const id = `SIMULATED-LINK-${req.bookingId}-${Date.now()}`;
    return {
      providerName: 'test_double',
      simulated: true,
      providerPaymentId: id,
      url: `https://payments.invalid/SIMULATED/${id}`,
      expiresAt: new Date(Date.now() + Math.max(1, req.expiresInHours) * 3600_000).toISOString(),
      wouldHaveDone: `SIMULATED: would have created a ${req.currency} ${req.amount.toFixed(2)} payment link (${req.description}).`,
    };
  },
  async fetchPaymentStatus(providerPaymentId, hint) {
    const paid = Math.max(0, Number(hint?.simulatePaidAmount) || 0);
    return {
      providerName: 'test_double',
      simulated: true,
      status: paid > 0 ? 'paid' : 'pending',
      amountPaid: paid,
      wouldHaveDone: `SIMULATED: would have asked the provider about ${providerPaymentId}.`,
    };
  },
  async refund(req) {
    return {
      providerName: 'test_double',
      simulated: true,
      status: 'succeeded',
      providerRefundId: `SIMULATED-REFUND-${Date.now()}`,
      wouldHaveDone: `SIMULATED: would have refunded ${req.currency} ${req.amount.toFixed(2)} (${req.reason}).`,
    };
  },
};

/**
 * The single place the active provider is chosen. SAFE BY DEFAULT: the test double, unless every
 * Square secret is present, SQUARE_ENVIRONMENT is valid and PAYMENTS_LIVE is exactly "true"
 * (see squareConfig.ts). A missing secret never half-configures Square.
 */
export function getPaymentProvider(get: SecretReader = name => secrets.get(name)): PaymentProvider {
  const cfg = readSquareConfig(get);
  return cfg ? createSquareProvider(cfg) : testDoubleProvider;
}
