import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { createPublicBooking } from '../../shared/publicBookingCreate.ts';

/**
 * Create a booking, a request or a Block Time row from the admin screens.
 *
 * Signed-in admins and active barbers only; who is acting comes from the login,
 * never from the body. All the work is done by the one shared booking creator
 * (publicBookingCreate) in its admin mode, so the submission-token idempotency,
 * catalogue pricing, coverage, test-data rule and audit row are the same ones the
 * public form and the assistant use.
 *
 * Body: { submission_token, kind?: 'booking' | 'block', ...fields }. The token is
 * minted once per open modal and sent unchanged on every retry of that save.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ error: 'Automation cannot create bookings here.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const out = await createPublicBooking(base44.asServiceRole, {
      body,
      req,
      byAdmin: { name: actor.name, tier: actor.tier === 'admin' ? 'admin' : 'staff', member_id: actor.member_id },
    });
    return out.status ? Response.json(out.body, { status: out.status }) : Response.json(out.body);
  } catch (error) {
    // A failed lookup (for example the token check) lands here: it is an error the page
    // retries with the same token, never a reason to create anything.
    console.error('[createAdminBooking]', (error as Error)?.message);
    return Response.json({ error: 'The booking could not be saved. Please try again.', retryable: true }, { status: 500 });
  }
}