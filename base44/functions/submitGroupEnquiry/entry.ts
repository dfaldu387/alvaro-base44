import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { validateGroupEnquiryInput } from '../../shared/publicBookingValidators.ts';
import { hashIp, takeRateLimitSlot } from '../../shared/bookingProtection.ts';

// Anyone can post an enquiry, so it is throttled per caller (a broken counter must
// never stop a real enquiry, so a limiter failure allows the request).
const ENQUIRY_LIMITS = { perMinute: 5, perHour: 20 };

// Public endpoint — no auth required.
// Validates and sanitises all input server-side, then creates the
// GroupBookingEnquiry using the service role.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    try {
      const verdict = await takeRateLimitSlot(base44.asServiceRole, 'group_enquiry', await hashIp(req), ENQUIRY_LIMITS);
      if (!verdict.allowed) {
        return Response.json(
          { error: 'Too many enquiries. Please wait a moment and try again.' },
          { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
        );
      }
    } catch (e) {
      console.error('[submitGroupEnquiry] rate limiter unavailable, allowing the enquiry', e?.message);
    }

    const { valid, errors, sanitized } = validateGroupEnquiryInput(body);
    if (!valid) {
      return Response.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const created = await base44.asServiceRole.entities.GroupBookingEnquiry.create(sanitized);
    return Response.json({ success: true, id: created.id });
  } catch (error) {
    console.error('[submitGroupEnquiry]', error?.message);
    return Response.json({ error: 'We could not send your enquiry. Please try again.' }, { status: 500 });
  }
}