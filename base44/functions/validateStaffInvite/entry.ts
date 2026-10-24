import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Public endpoint: validates a staff invitation token and returns the member
// details so the invite page can pre-fill the form. No auth required — the
// token itself is the credential.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const { token } = body;
    if (!token) return Response.json({ error: 'Invalid invitation link.' }, { status: 400 });

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

    // Check if a User account already exists for this email
    const existingUsers = await base44.asServiceRole.entities.User.filter({ email: member.email });
    const existing_account = existingUsers && existingUsers.length > 0;

    return Response.json({
      valid: true,
      name: member.name,
      email: member.email,
      role: member.role,
      phone: member.phone,
      job_title: member.job_title,
      existing_account,
    });
  } catch (error) {
    console.error('[validateStaffInvite]', error?.message);
    return Response.json({ error: 'We could not check this invitation. Please try again.' }, { status: 500 });
  }
}