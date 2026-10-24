import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { recordAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

// Admin-only endpoint: creates/updates a TeamMember, generates a secure expiring
// invite token, and sends the invitation email with a link to the staff invite
// acceptance page. The User account is NOT created here — it is created when the
// staff member accepts the invitation via /staff/invite/:token.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const { name, email, phone, job_title, role, is_bookable, working_hours, member_id } = body;

    // ── Validate ──────────────────────────────────────────────────────────
    if (!name || !name.trim()) return Response.json({ error: 'Name is required' }, { status: 400 });
    if (!email || !email.trim()) return Response.json({ error: 'Email is required' }, { status: 400 });
    const emailClean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) return Response.json({ error: 'Valid email is required' }, { status: 400 });

    const memberRole = role || 'barber';
    const roleLabel = memberRole === 'admin' ? 'Admin' : memberRole === 'owner' ? 'Owner' : 'Barber';

    // ── Generate secure token (32 random bytes → 64-char hex) ─────────────
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes, b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const appBase = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(appBase)) return Response.json({ error: 'APP_BASE_URL is not configured' }, { status: 500 });
    const inviteUrl = `${appBase}/staff/invite/${token}`;

    const emailBody = `Hi ${name.trim()},\n\nYou've been invited to join the Cut Deluxe team as a ${roleLabel}.\n\nClick the link below to set up your staff account:\n${inviteUrl}\n\nThis invitation will expire in 7 days.\n\nIf you weren't expecting this invitation, you can safely ignore this email.\n\n— Cut Deluxe`;

    // Written BEFORE the member is saved and the invitation is emailed; if it cannot be
    // written, nothing is saved or sent. The role and ids only: no name, email or phone.
    const logged = await recordAudit(base44.asServiceRole, {
      action: 'staff_invited', who: user.full_name || user.email || 'Admin',
      summary: member_id ? 'A staff invitation was re-sent' : 'A staff member was invited',
      note: `Role: ${memberRole}`, ids: { team_member_id: member_id },
    });
    if (!logged) return Response.json(AUDIT_REFUSED, { status: 500 });

    // ── Resend / update existing member ──────────────────────────────────
    if (member_id) {
      const existing = await base44.asServiceRole.entities.TeamMember.get(member_id);
      if (!existing) return Response.json({ error: 'Team member not found' }, { status: 404 });

      const updated = await base44.asServiceRole.entities.TeamMember.update(member_id, {
        name: name.trim(),
        email: emailClean,
        phone: (phone || '').trim(),
        job_title: job_title || 'Barber',
        role: memberRole,
        is_bookable: is_bookable ?? true,
        invite_status: 'invite_sent',
        invite_token: token,
        invite_expires_at: expiresAt,
        invite_accepted_at: null,
        status: 'Active',
      });

      await base44.asServiceRole.integrations.Core.SendEmail({
        to: emailClean,
        subject: "You're invited to join Cut Deluxe",
        body: emailBody,
      });

      return Response.json({ success: true, member: updated });
    }

    // ── Create new member ────────────────────────────────────────────────
    const member = await base44.asServiceRole.entities.TeamMember.create({
      name: name.trim(),
      email: emailClean,
      phone: (phone || '').trim(),
      job_title: job_title || 'Barber',
      role: memberRole,
      is_bookable: is_bookable ?? true,
      status: 'Active',
      invite_status: 'invite_sent',
      invite_token: token,
      invite_expires_at: expiresAt,
      initials: name.trim().slice(0, 2).toUpperCase(),
      avatar_color: '#3B82F6',
      working_hours: working_hours || [],
      special_hours: [],
      assigned_service_ids: [],
      notification_email_bookings: true,
    });

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: emailClean,
      subject: "You're invited to join Cut Deluxe",
      body: emailBody,
    });

    return Response.json({ success: true, member });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}