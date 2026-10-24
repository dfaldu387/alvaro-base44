import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createPublicBooking } from '../../shared/publicBookingCreate.ts';

// Public endpoint — no auth required.
// Validates and sanitises all input server-side, then creates the BookingRequest
// using the service role so the public never touches the entity directly.
// The whole creation path (validation, duplicate detection, booking window,
// coverage, pricing, protection, follow-ups) lives in shared/publicBookingCreate,
// because the AI assistant creates bookings through the very same code.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const out = await createPublicBooking(base44.asServiceRole, { body, req });
    return out.status ? Response.json(out.body, { status: out.status }) : Response.json(out.body);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}