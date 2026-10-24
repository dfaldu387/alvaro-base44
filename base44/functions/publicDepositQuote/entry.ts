import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { hashIp, takeRateLimitSlot } from '../../shared/bookingProtection.ts';
import { quoteDeposit } from '../../shared/depositQuote.ts';

// Public endpoint — no auth required. Read-only: it creates and changes nothing.
// Tells the Review step what deposit the server would ask for. It is advisory: submitPublicBooking
// makes its own decision and never reads anything from this call. Answers { required, amount } and one
// fixed line, never a reason, a no-show count or whether the customer is known.
//
// A quote is not a booking: it has its own counters, so it never uses up a booking allowance.
const QUOTE_LIMITS = { perMinute: 12, perHour: 90 };

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const admin = base44.asServiceRole;

    // This answer says a little about who has booked before, so unlike the page-load limiter a broken
    // counter fails CLOSED: the quote is skipped, the booking itself is untouched.
    let verdict;
    try {
      verdict = await takeRateLimitSlot(admin, 'public_deposit_quote', await hashIp(req), QUOTE_LIMITS);
    } catch (e) {
      console.error('[publicDepositQuote] rate limiter unavailable', e?.message);
      return Response.json({ error: 'Quote unavailable.' }, { status: 503 });
    }
    if (!verdict.allowed) {
      return Response.json(
        { error: 'Too many requests. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
      );
    }

    return Response.json(await quoteDeposit(admin, body));
  } catch (error) {
    console.error('[publicDepositQuote] failed', error?.message);
    return Response.json({ error: 'Quote unavailable.' }, { status: 500 });
  }
}