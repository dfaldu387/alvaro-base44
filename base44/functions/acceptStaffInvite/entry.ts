import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Public endpoint: called after the staff member has registered their account
// via base44.auth.register(). Links the newly created User to the TeamMember,
// sets the User's role to match the TeamMember's role, marks the invitation
// as accepted, and clears the token so it can't be reused.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const { token, phone, link_existing } = body;
    if (!token) return Response.json({ error: 'Invalid invitation link.' }, { status: 400 });

    // ── Find the TeamMember by token ──────────────────────────────────────
    const members = await base44.asServiceRole.entities.TeamMember.filter({ invite_token: token });
    if (!members || members.length === 0) {
      return Response.json({ error: 'Invalid or expired invitation link.' }, { status: 404 });
    }

    const member = members[0];

    if (member.invite_accepted_at) {
      return Response.json({ error: 'This invitation has already been used.' }, { status: 400 });
    }

    if (member.invite_expires_at && new Date(member.invite_expires_at) < new Date()) {
      return Response.json({ error: 'This invitation has expired.' }, { status: 400 });
    }

    // ── Link existing account mode ──────────────────────────────────────────
    // Used when the invited email already belongs to an authenticated User.
    // The user must sign in first (client-side loginViaEmailPassword), then
    // this function verifies the authenticated email matches the invite and
    // links the User to the TeamMember.
    // Every path requires the caller to be signed in as the invited email.
    {
      const me = await base44.auth.me().catch(() => null);
      if (!me) {
        return Response.json({ error: 'Authentication required. Please sign in to link your existing account.' }, { status: 401 });
      }
      if (me.email !== member.email) {
        return Response.json({ error: 'The signed-in account does not match the invitation email.' }, { status: 403 });
      }
      const userRole = (member.role === 'admin' || member.role === 'owner') ? 'admin' : 'user';
      await base44.asServiceRole.entities.User.update(me.id, { role: userRole });
      const updated = await base44.asServiceRole.entities.TeamMember.update(member.id, {
        user_id: me.id,
        invite_status: 'active',
        invite_accepted_at: new Date().toISOString(),
        invite_token: null,
        invite_expires_at: null,
        phone: (phone || '').trim() || member.phone,
        status: 'Active',
      });
      return Response.json({ success: true, member: updated });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}