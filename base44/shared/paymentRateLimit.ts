import { takeRateLimitSlot, hashIp } from './bookingProtection.ts';

/**
 * Throttles for the two payment surfaces that cost something per call. Both reuse the one
 * RateLimitHit limiter (fixed windows, one counter row per caller per window, a refused
 * request is never counted).
 *
 *  - Payment links: per booking. A barber re-tapping "Pay by card" reuses the same link, so
 *    a handful a minute is plenty, and nobody can hammer Square through one booking.
 *  - Webhook: only requests that FAILED the signature check are counted, per sender address.
 *    A genuine Square delivery is never throttled; a burst of forged ones stops writing to the
 *    database once the ceiling is reached (after that it is a read and a 429).
 */
export const PAYMENT_LINK_LIMITS = { perMinute: 5, perHour: 30 };
export const BAD_SIGNATURE_LIMITS = { perMinute: 20, perHour: 200 };

export async function takePaymentLinkSlot(admin: any, bookingId: string) {
  return takeRateLimitSlot(admin, 'paylink', String(bookingId || 'none'), PAYMENT_LINK_LIMITS);
}

export async function takeBadSignatureSlot(admin: any, req: Request) {
  return takeRateLimitSlot(admin, 'sqwebhook_bad', await hashIp(req), BAD_SIGNATURE_LIMITS);
}

export const tooMany = (retryAfterSeconds: number, error = 'Too many requests. Try again shortly.') =>
  Response.json({ error }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });