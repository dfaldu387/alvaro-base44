import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { createAdminClients } from '../../shared/adminClientCreate.ts';

/**
 * Create client records from the admin screens (Add Client, CSV import, Create Booking,
 * Favourite). Signed-in admins and active barbers only; automation is refused. The person
 * comes from the login, never the body. is_test is decided by the server from the name.
 *
 * Body: { clients: [{ ...client fields, from_booking_id? }], match_existing?: boolean }
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ error: 'Automation cannot create clients here.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const out = await createAdminClients(base44.asServiceRole, { body, who: actor.name });
    return out.status ? Response.json(out.body, { status: out.status }) : Response.json(out.body);
  } catch (error) {
    console.error('[createAdminClients]', (error as Error)?.message);
    return Response.json({ error: 'The client could not be saved. Please try again.' }, { status: 500 });
  }
}