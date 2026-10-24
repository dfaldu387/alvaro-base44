import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { recordAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

// Manages Team Member lifecycle: deactivate, reactivate, or delete.
// Only admins can call this. The Owner role can never be modified here.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // ── Verify caller is admin ─────────────────────────────────────────────
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (me.role !== 'admin') {
      return Response.json({ error: 'Only admins can manage team members.' }, { status: 403 });
    }

    let body = {};
    try { body = await req.json(); } catch { /* empty */ }
    const { member_id, mode } = body;

    if (!member_id) return Response.json({ error: 'Member ID required.' }, { status: 400 });
    if (!mode || !['deactivate', 'reactivate', 'delete'].includes(mode)) {
      return Response.json({ error: 'Invalid mode.' }, { status: 400 });
    }

    // ── Find the TeamMember ────────────────────────────────────────────────
    let member;
    try {
      member = await base44.asServiceRole.entities.TeamMember.get(member_id);
    } catch {
      return Response.json({ error: 'Team member not found.' }, { status: 404 });
    }
    if (!member) {
      return Response.json({ error: 'Team member not found.' }, { status: 404 });
    }

    // ── Prevent modifying the Owner ─────────────────────────────────────────
    if (member.role === 'owner') {
      return Response.json({ error: 'The Owner account cannot be modified.' }, { status: 403 });
    }

    // Written BEFORE the change; if it cannot be written, the change is not made.
    // Identifiers and the role only: no name, email or phone.
    const auditFirst = (action, summary) => recordAudit(base44.asServiceRole, {
      action, summary, who: me.full_name || me.email || 'Admin',
      note: `Role: ${member.role || 'barber'}`, ids: { team_member_id: member_id },
    });

    // Helper: map TeamMember role to User role
    const userRoleFor = (tmRole) => (tmRole === 'owner' || tmRole === 'admin') ? 'admin' : 'user';

    // Helper: best-effort User role update — never block TeamMember lifecycle
    // on a stale/missing user reference (e.g. user was already deleted).
    const safeUpdateUserRole = async (userId, role) => {
      if (!userId) return;
      try {
        await base44.asServiceRole.entities.User.update(userId, { role });
      } catch (e) {
        console.warn(`[removeTeamMember] Could not update User ${userId} role to "${role}": ${e.message}`);
      }
    };

    // ── Delete mode: permanent deletion ─────────────────────────────────────
    if (mode === 'delete') {
      const bookings = await base44.asServiceRole.entities.BookingRequest.filter({ team_member_id: member_id });
      if (bookings && bookings.length > 0) {
        return Response.json({
          error: 'This team member has existing bookings and cannot be permanently deleted. Deactivate instead to preserve historical data.',
        }, { status: 400 });
      }

      if (!(await auditFirst('team_member_deleted', 'A team member was permanently deleted'))) return Response.json(AUDIT_REFUSED, { status: 500 });

      // Best-effort: demote the linked User to revoke staff access (if user still exists)
      await safeUpdateUserRole(member.user_id, 'customer');

      await base44.asServiceRole.entities.TeamMember.delete(member_id);
      return Response.json({ success: true, deleted: true });
    }

    // ── Deactivate mode: archive ────────────────────────────────────────────
    if (mode === 'deactivate') {
      if (!(await auditFirst('team_member_deactivated', 'A team member was deactivated and their access removed'))) return Response.json(AUDIT_REFUSED, { status: 500 });
      await safeUpdateUserRole(member.user_id, 'customer');

      const updated = await base44.asServiceRole.entities.TeamMember.update(member_id, {
        status: 'Inactive',
        is_bookable: false,
        invite_status: 'inactive',
        invite_token: null,
        invite_expires_at: null,
      });

      return Response.json({ success: true, member: updated });
    }

    // ── Reactivate mode: restore access ─────────────────────────────────────
    if (!(await auditFirst('team_member_reactivated', 'A team member was reactivated and their access restored'))) return Response.json(AUDIT_REFUSED, { status: 500 });
    await safeUpdateUserRole(member.user_id, userRoleFor(member.role));

    const updated = await base44.asServiceRole.entities.TeamMember.update(member_id, {
      status: 'Active',
      is_bookable: true,
      invite_status: member.user_id ? 'active' : (member.invite_status || 'not_invited'),
    });

    return Response.json({ success: true, member: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}