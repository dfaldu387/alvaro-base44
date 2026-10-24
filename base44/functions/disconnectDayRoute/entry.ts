import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

/**
 * Disconnect Route — the reverse of Finalise Route (the Calendar's Connect
 * Appointments): the day goes back to a flexible draft.
 *
 * body:
 *   date            (required)  YYYY-MM-DD
 *   team_member_id  (optional)  the barber whose route is being disconnected
 *   is_test         (optional)  the test universe only
 *
 * What it removes is only the CONNECTION, never a booking:
 *   - the day's derived drive legs (RouteConnection rows),
 *   - the day's DayRoute record, so the day reads as a draft again.
 * No appointment is moved, cancelled or unconfirmed, and no message is queued.
 *
 * It refuses once the route is being executed: the day's progress (on the way,
 * arrived, completed) lives on that record, so disconnecting it would destroy
 * the account of what actually happened.
 *
 * Authority is resolved before any read or write, the intent is recorded in the
 * activity log BEFORE anything is deleted, and the row is finished with the real
 * counts afterwards.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const date = String(body?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'A date (YYYY-MM-DD) is required to disconnect a route.' }, { status: 400 });
    }
    const teamMemberId = body?.team_member_id ? String(body.team_member_id) : null;
    const isTest = typeof body?.is_test === 'boolean' ? body.is_test : undefined;
    const who = actor.automation ? 'Route Flow workflow' : (actor.name || 'Admin');

    const listRows = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
    const inScope = (row: any) =>
      (!teamMemberId || String(row.team_member_id || '') === teamMemberId) &&
      (isTest === undefined || (row.is_test === true) === isTest);

    // ── 1. The day as it stands ─────────────────────────────────────────────
    let dayRows: any[] = [];
    let records: any[] = [];
    try { dayRows = listRows(await admin.entities.BookingRequest.filter({ requested_date: date }, '-created_date', 400)); } catch { dayRows = []; }
    try { records = listRows(await admin.entities.DayRoute.filter({ date }, '-created_date', 50)).filter(inScope); } catch { records = []; }

    // ── 2. A route being executed cannot be disconnected ────────────────────
    const started = records.some((r: any) =>
      (Array.isArray(r.stop_execution) ? r.stop_execution : []).some((s: any) => s?.state && s.state !== 'planned'),
    );
    if (started) {
      return Response.json({
        ok: false,
        code: 'ROUTE_IN_EXECUTION',
        message: 'This route is already being executed, so it cannot be disconnected.',
      }, { status: 409 });
    }

    const ids = new Set<string>(dayRows.filter(inScope).map((r: any) => String(r.id)));

    // ── 3. The record of who did it, before anything is deleted ─────────────
    const audit = {
      action: 'route_disconnected',
      who,
      automation: actor.automation,
      summary: 'A connected route was disconnected and the day returned to a draft',
      counts: { routes_cleared: records.length },
      related: { type: 'DayRoute' as const, id: records[0]?.id || null },
    };
    const auditId = await recordAudit(admin, audit);
    if (!auditId) return Response.json(AUDIT_REFUSED, { status: 503 });

    // ── 4. Remove the drive legs this day can no longer justify ─────────────
    let legsRemoved = 0;
    try {
      const rows = listRows(await admin.entities.RouteConnection.filter({ date }, '-created_date', 400));
      const doomed = rows
        .filter((c: any) => {
          const from = String(c.from_appointment_id || '').replace(/^db-/, '');
          const to = String(c.to_appointment_id || '').replace(/^db-/, '');
          return ids.has(from) || ids.has(to);
        })
        .map((c: any) => c.id);
      if (doomed.length > 0) {
        await admin.entities.RouteConnection.deleteMany({ id: { $in: doomed } });
        legsRemoved = doomed.length;
      }
    } catch { /* a leftover leg is corrected the next time the day is connected */ }

    // ── 5. The day reads as a draft again ───────────────────────────────────
    let cleared = 0;
    if (records.length > 0) {
      try {
        await admin.entities.DayRoute.deleteMany({ id: { $in: records.map((r: any) => r.id) } });
        cleared = records.length;
      } catch {
        return Response.json({
          ok: false,
          code: 'WRITE_FAILED',
          message: 'The route could not be cleared, so the day is unchanged.',
        }, { status: 500 });
      }
    }

    await finishAudit(admin, auditId, {
      ...audit,
      counts: { routes_cleared: cleared, drive_legs_removed: legsRemoved },
    });

    return Response.json({
      ok: true,
      date,
      routes_cleared: cleared,
      drive_legs_removed: legsRemoved,
      message: 'Route disconnected — the day is a draft again.',
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}