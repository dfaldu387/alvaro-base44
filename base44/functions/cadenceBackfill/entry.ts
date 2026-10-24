import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { runCadenceBackfill } from '../../shared/cadenceBackfill.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

/**
 * cadenceBackfill — measure every client's real visit rhythm. Administrator only.
 * { apply: false } (default) is a preview and writes nothing. { apply: true } writes the cadence fields.
 * { monthly_is_default: true } is the admin's explicit statement that a bare "Monthly" on an older record
 * was never a decision, so a measurement may replace it. Sends no message of any kind.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body = preview */ }
    const apply = body?.apply === true;
    const admin = base44.asServiceRole;
    // The client rows record no person, so the log row is the only record of who ran this.
    // On apply it is written FIRST; if it cannot be written, nothing is changed.
    const auditBase = { action: 'cadence_backfill', who: actor.name, summary: 'Reminder cadence was measured for existing clients' };
    let logId: string | null = null;
    if (apply) {
      logId = await recordAudit(admin, { ...auditBase, note: 'Started; replaced by the final counts when the run finishes.' });
      if (!logId) return Response.json({ ok: false, ...AUDIT_REFUSED }, { status: 500 });
    }
    const report = await runCadenceBackfill(admin, { apply, monthlyIsDefault: body?.monthly_is_default === true });
    if (apply) {
      await finishAudit(admin, logId, {
        ...auditBase,
        note: `${report.records_written} records written, ${report.becoming_due_now} clients become due now, ${report.dates_sooner} sooner, ${report.dates_later} later.`,
      });
    }
    return Response.json({ ok: true, report });
  } catch (e) {
    console.error('[cadenceBackfill] failed', (e as Error)?.message);
    return Response.json({ ok: false, error: 'The cadence measurement could not be completed.' }, { status: 500 });
  }
}