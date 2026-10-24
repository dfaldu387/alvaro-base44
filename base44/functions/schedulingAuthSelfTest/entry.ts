import { resolveSchedulingActor, requireAdminActor, actorOwnsBooking } from '../../shared/schedulingAuth.ts';

/**
 * TEMPORARY — exercises the REAL shared scheduling gate with simulated identities
 * (no customer login exists in this app, so a real one cannot be used).
 * Returns only pass/fail per case. Removed after Stage 0 verification.
 */
export default async function (_req) {
  try {
    const mkClient = (user: any, members: any[]) => ({
      auth: { me: async () => { if (!user) throw new Error('not authenticated'); return user; } },
      entities: {
        TeamMember: {
          filter: async (q: any) => members.filter(m =>
            (q?.user_id && m.user_id === q.user_id) || (q?.email && m.email === q.email)),
        },
      },
    });
    const mkReq = (headers: Record<string, string>) => new Request('https://example.test/fn', { method: 'POST', headers });
    const BEARER = { authorization: 'Bearer x' };

    const admin = { id: 'u-admin', email: 'admin@example.test', role: 'admin', full_name: 'Admin User' };
    const customer = { id: 'u-cust', email: 'customer@example.test', role: 'user', full_name: 'Customer' };
    const barber = { id: 'u-barb', email: 'barber@example.test', role: 'user', full_name: 'Barber' };
    const barberMember = { id: 'M1', user_id: 'u-barb', email: 'barber@example.test', name: 'Barber', role: 'barber', status: 'Active' };
    const inactiveMember = { id: 'M2', user_id: 'u-cust', email: 'customer@example.test', name: 'Gone', role: 'barber', status: 'Inactive' };
    const ownerMember = { id: 'M3', user_id: 'u-barb', email: 'barber@example.test', name: 'Owner', role: 'owner', status: 'Active' };

    const out: any[] = [];
    const t = (name: string, pass: boolean, got?: any) => out.push({ name, pass, got });

    // Anonymous: no credential at all (even if an identity could be resolved)
    let a = await resolveSchedulingActor(mkClient(admin, []), mkReq({}));
    t('anonymous, no credential -> 401', !a.ok && a.status === 401, a.status);
    // Credential present but it does not resolve to a user
    a = await resolveSchedulingActor(mkClient(null, []), mkReq(BEARER));
    t('credential but no user -> 401', !a.ok && a.status === 401, a.status);
    // Ordinary customer (signed in, no staff record)
    a = await resolveSchedulingActor(mkClient(customer, []), mkReq(BEARER));
    t('signed-in customer (validator gate) -> 403', !a.ok && a.status === 403, a.status);
    a = await requireAdminActor(mkClient(customer, []), mkReq(BEARER));
    t('signed-in customer (reshuffle apply / auto-place gate) -> 403', !a.ok && a.status === 403, a.status);
    // Customer whose staff record is inactive
    a = await resolveSchedulingActor(mkClient(customer, [inactiveMember]), mkReq(BEARER));
    t('inactive staff record -> 403', !a.ok && a.status === 403, a.status);
    // Staff
    a = await resolveSchedulingActor(mkClient(barber, [barberMember]), mkReq(BEARER));
    t('staff allowed by validator gate', a.ok && a.tier === 'staff', a.tier);
    t('staff can never override', a.ok && a.can_override === false, a.can_override);
    t('staff may act on OWN booking', actorOwnsBooking(a, { team_member_id: 'M1' }) === true);
    t('staff refused on ANOTHER barber booking', actorOwnsBooking(a, { team_member_id: 'M9' }) === false);
    t('staff refused on an unassigned booking', actorOwnsBooking(a, {}) === false);
    a = await requireAdminActor(mkClient(barber, [barberMember]), mkReq(BEARER));
    t('staff refused by admin-only gate -> 403', !a.ok && a.status === 403, a.status);
    // Admin
    a = await resolveSchedulingActor(mkClient(admin, []), mkReq(BEARER));
    t('admin allowed', a.ok && a.tier === 'admin', a.tier);
    t('admin may override', a.ok && a.can_override === true, a.can_override);
    t('admin may act on any booking', actorOwnsBooking(a, { team_member_id: 'M9' }) === true);
    // Owner staff record promotes to admin tier
    a = await resolveSchedulingActor(mkClient(barber, [ownerMember]), mkReq(BEARER));
    t('owner staff record -> admin tier', a.ok && a.tier === 'admin', a.tier);
    // Automation
    a = await requireAdminActor(mkClient(admin, []), mkReq({ ...BEARER, 'x-workflow-run': 'run-1' }));
    t('workflow identity allowed by admin gate', a.ok && a.automation === true, a.automation);
    t('automation labelled in the audit trail', a.ok && a.role_label === 'automation', a.role_label);
    t('automation can NEVER override', a.ok && a.can_override === false, a.can_override);
    // A stranger forging the workflow header gains nothing
    a = await requireAdminActor(mkClient(null, []), mkReq({ 'x-workflow-run': 'forged' }));
    t('forged workflow header without credential -> 401', !a.ok && a.status === 401, a.status);
    a = await requireAdminActor(mkClient(customer, []), mkReq({ ...BEARER, 'x-workflow-run': 'forged' }));
    t('forged workflow header as customer -> 403', !a.ok && a.status === 403, a.status);

    return Response.json({ passed: out.filter(o => o.pass).length, total: out.length, failed: out.filter(o => !o.pass), results: out });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}