/**
 * Scheduling authority — ONE gate for every endpoint that can read the
 * schedule, validate a placement or change an appointment.
 *
 * Authority comes from the authenticated identity, never from the request body:
 *   admin  — app admin, or a linked TeamMember marked owner/admin.
 *            Full control of the calendar and the only tier allowed to use an
 *            explicit customer-availability override.
 *   staff  — a linked, active TeamMember (barber). May place or move their OWN
 *            appointments only, and may never override.
 *   none   — everyone else (including an authenticated account with no staff
 *            record, e.g. a customer login): refused BEFORE any privileged read,
 *            write or Mapbox work.
 *
 * Background automation: the platform's workflow runner invokes a function with
 * a valid service identity (which resolves to admin) and adds an
 * `x-workflow-run` header. That header is used ONLY to label an action as
 * automation in the audit trail — authority itself always comes from the
 * authenticated identity, so an unauthenticated caller can never gain access by
 * sending the header (they are rejected first) and a forged header can never
 * escalate anyone (it only ever downgrades the label).
 */

export type AuthorityTier = 'admin' | 'staff' | 'none';

export interface SchedulingActor {
  ok: boolean;
  status: number;
  error: string | null;
  tier: AuthorityTier;
  can_override: boolean;
  automation: boolean;
  user: any;
  member: any;
  name: string;
  role_label: 'admin' | 'staff' | 'automation';
  /** Staff may only act on bookings assigned to their own team member record. */
  member_id: string | null;
}

const refusal = (status: number, error: string): SchedulingActor => ({
  ok: false,
  status,
  error,
  tier: 'none',
  can_override: false,
  automation: false,
  user: null,
  member: null,
  name: '',
  role_label: 'staff',
  member_id: null,
});

/** Finds the staff record linked to this login (by user id, then by email). */
async function findMemberFor(base44: any, user: any): Promise<any> {
  const pick = (res: any) => {
    const items = Array.isArray(res) ? res : (res?.items || []);
    return (items || [])[0] || null;
  };
  try {
    if (user?.id) {
      const byId = pick(await base44.entities.TeamMember.filter({ user_id: user.id }, '-created_date', 5));
      if (byId) return byId;
    }
  } catch { /* fall through to email */ }
  try {
    if (user?.email) {
      return pick(await base44.entities.TeamMember.filter({ email: user.email }, '-created_date', 5));
    }
  } catch { /* no staff record */ }
  return null;
}

/** Resolves the caller's authority. Never throws — everything unknown is refused. */
export async function resolveSchedulingActor(base44: any, req: Request): Promise<SchedulingActor> {
  // An explicit credential is required before authority is even considered.
  // Verified live: a signed-in admin call and the platform's workflow runner both
  // present an `authorization` header, while an anonymous request to a public
  // function route presents none — so this one check refuses strangers, and is
  // evaluated before any privileged read, write or Mapbox call.
  let credential = false;
  try {
    credential = !!req.headers.get('authorization');
  } catch {
    credential = false;
  }
  if (!credential) return refusal(401, 'Authentication required.');

  let user: any = null;
  try {
    user = await base44.auth.me();
  } catch {
    user = null;
  }
  if (!user) return refusal(401, 'Authentication required.');

  let automation = false;
  try {
    automation = !!req.headers.get('x-workflow-run');
  } catch {
    automation = false;
  }

  const member = await findMemberFor(base44, user);
  const memberActive = !!member && member.status !== 'Inactive';
  const managesTeam = memberActive && (member.role === 'owner' || member.role === 'admin');

  if (user.role === 'admin' || managesTeam) {
    return {
      ok: true,
      status: 200,
      error: null,
      tier: 'admin',
      // Automation can never hold manual override rights, however it is labelled.
      can_override: !automation,
      automation,
      user,
      member: member || null,
      name: member?.name || user.full_name || user.email || 'Admin',
      role_label: automation ? 'automation' : 'admin',
      member_id: member?.id || null,
    };
  }

  if (memberActive) {
    return {
      ok: true,
      status: 200,
      error: null,
      tier: 'staff',
      can_override: false,
      automation,
      user,
      member,
      name: member.name || user.full_name || user.email || 'Staff',
      role_label: 'staff',
      member_id: member.id || null,
    };
  }

  return refusal(403, 'You do not have permission to view or change the schedule.');
}

/**
 * Administrator (or trusted automation, which carries the same identity) only.
 * Used by auto-placement, reshuffle evaluation, reshuffle apply and overrides.
 */
export async function requireAdminActor(base44: any, req: Request): Promise<SchedulingActor> {
  const actor = await resolveSchedulingActor(base44, req);
  if (!actor.ok) return actor;
  if (actor.tier !== 'admin') return refusal(403, 'Administrator permission is required.');
  return actor;
}

/** May this actor change this specific booking? Admins: any. Staff: their own only. */
export function actorOwnsBooking(actor: SchedulingActor, booking: any): boolean {
  if (actor.tier === 'admin') return true;
  if (actor.tier !== 'staff' || !actor.member_id) return false;
  return !!booking?.team_member_id && booking.team_member_id === actor.member_id;
}