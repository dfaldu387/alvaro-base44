import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { createPaymentForBooking, evaluateForBooking, loadDepositRules } from '../../shared/paymentService.ts';
import { paymentKindFor, paymentOrLegacy } from '../../shared/ensurePayment.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

/**
 * migratePaymentState — admin only. The repair for bookings that have no payment record (the "Repair payment
 * records" panel on the Payments page). Gives each one a BookingPayment row.
 *   Paid   -> paid_in_full (amount = booking price)
 *   Unpaid -> not_required, unless a deposit rule applies to an open, upcoming booking.
 * Time blocks and held requests are left alone (a held request gets its record when an admin approves it).
 * body: { dry_run?: boolean (default true), limit?: number }
 * A preview (dry_run) reads and counts and writes NOTHING. Idempotent: bookings that already have a row are
 * skipped, so running it twice changes nothing the second time. Queues no messages.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const dryRun = body?.dry_run !== false;
    const limit = Math.min(Math.max(Number(body?.limit) || 500, 1), 1000);

    const bookings = asList(await admin.entities.BookingRequest.list('-created_date', limit));
    // Asked for by booking id, in chunks, so the answer never depends on how many payment rows exist in total.
    const have = new Set<string>();
    for (let i = 0; i < bookings.length; i += 100) {
      const ids = bookings.slice(i, i + 100).map((b: any) => b.id);
      for (const p of asList(await admin.entities.BookingPayment.filter({ booking_request_id: { $in: ids } }, 'created_date', 300))) have.add(p.booking_request_id);
    }
    const todo = bookings.filter((b: any) => !have.has(b.id) && paymentKindFor(b) !== 'skip');

    const counts = { looked_at: bookings.length, already_done: bookings.length - todo.length, to_migrate: todo.length, paid_in_full: 0, not_required: 0, deposit_due: 0, has_more: bookings.length >= limit };
    // A real (not dry) run writes payment records: recorded BEFORE it starts, or it does not start.
    const auditBase = { action: 'payment_state_migrated', who: actor.name, summary: 'Payment records were created for earlier bookings' };
    let logId: string | null = null;
    if (!dryRun && todo.length > 0) {
      logId = await recordAudit(admin, { ...auditBase, note: 'Planned counts; replaced by the final counts when the run finishes.', counts: { to_migrate: todo.length } });
      if (!logId) return Response.json(AUDIT_REFUSED, { status: 500 });
    }
    const rules = await loadDepositRules(admin);
    for (const b of todo) {
      if (b.payment_status === 'Paid') {
        counts.paid_in_full++;
        if (!dryRun) await paymentOrLegacy(admin, b, actor.name);
        continue;
      }
      if (paymentKindFor(b) === 'evaluate') {
        // The same decision the real run makes. Nothing is written by the preview, and no text is queued either way.
        const needs = rules?.enabled === true && (await evaluateForBooking(admin, b, rules)).required;
        if (needs) counts.deposit_due++; else counts.not_required++;
        if (!dryRun) await createPaymentForBooking(admin, b, { enqueue: false });
        continue;
      }
      counts.not_required++;
      if (!dryRun) await paymentOrLegacy(admin, b, actor.name);
    }
    await finishAudit(admin, logId, { ...auditBase, counts: { ...counts, has_more: counts.has_more ? 1 : 0 } });
    return Response.json({ dry_run: dryRun, ...counts, note: dryRun ? 'Nothing written. This is only a preview.' : 'Repaired.' });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}