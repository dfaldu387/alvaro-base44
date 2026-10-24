import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { normaliseAuPhone } from '../../shared/auPhone.ts';
import { hashIp, takeRateLimitSlot } from '../../shared/bookingProtection.ts';

// A name + phone lookup can be guessed at, so it is throttled per caller. Unlike the
// address search, if the limiter cannot be reached the lookup is REFUSED: this one
// returns personal booking details.
const STATUS_LOOKUP_LIMITS = { perMinute: 10, perHour: 60 };

// Public endpoint — no auth required.
// Requires both full name AND mobile number to match the same BookingRequest.
// Returns a generic no-match response when either value is wrong, so callers
// cannot determine whether a name or phone exists.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    let verdict;
    try { verdict = await takeRateLimitSlot(base44.asServiceRole, 'check_booking_status', await hashIp(req), STATUS_LOOKUP_LIMITS); }
    catch { verdict = { allowed: false, retryAfterSeconds: 60 }; }
    if (!verdict.allowed) {
      return Response.json(
        { bookings: [], message: 'Too many attempts. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
      );
    }

    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const phone = (typeof body.phone === 'string' ? body.phone : '').trim();

    // Validate both fields are present
    if (!name || name.length < 2) {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      return Response.json({ error: 'Mobile number is required' }, { status: 400 });
    }

    const inputPhone = normalizeAuPhone(phone);

    // Fetch candidate bookings by name (exact), then verify phone in code.
    const bookings = await base44.asServiceRole.entities.BookingRequest.filter(
      { client_name: name },
      '-created_date',
      20
    );

    // Only keep bookings whose normalized phone matches the input phone.
    const matched = (bookings || []).filter(b => {
      const stored = normalizeAuPhone(b.phone || '');
      return stored && stored === inputPhone;
    });

    if (matched.length === 0) {
      // Generic response — do not reveal which field was wrong.
      return Response.json({
        bookings: [],
        message: "We couldn't find a booking matching those details.",
      });
    }

    // Return only sanitised fields the customer needs.
    const sanitized = matched.map(b => ({
      id: b.id,
      status: b.status,
      assigned_time: b.assigned_time,
      day: b.day,
      // The customer needs to know WHICH Friday. Without this the page can only show a weekday,
      // which is unreadable for anything more than a week out. It is their own booking's date.
      requested_date: b.requested_date || null,
      availability_window: b.availability_window,
      services: Array.isArray(b.services) ? b.services : [],
    }));

    return Response.json({ bookings: sanitized });
  } catch (error) {
    // Never expose raw backend/database errors to the public.
    console.error('[checkBookingStatus]', error);
    return Response.json({
      bookings: [],
      message: "We couldn't find a booking matching those details.",
    }, { status: 200 });
  }
}

// Phone normalisation lives in the shared helper (base44/shared/auPhone.ts).
// An unsupported number yields '' and so can never match a booking.
function normalizeAuPhone(raw) {
  return normaliseAuPhone(raw) || '';
}