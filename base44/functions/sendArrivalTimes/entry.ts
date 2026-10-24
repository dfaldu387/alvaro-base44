import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { runArrivalTimes, getSendHour, sydneyNow, addDays } from '../../shared/arrivalTimes.ts';
import { recordJobRun } from '../../shared/jobHeartbeat.ts';
import { runPreAppointmentReminders } from '../../shared/preAppointmentReminder.ts';

/**
 * sendArrivalTimes — the evening job. Queues the arrival_time message for every
 * eligible booking on tomorrow's finalised routes (Australia/Sydney), on the
 * existing outbox. Admin-gated (the workflow runner presents the service identity).
 *
 * body (all optional):
 *   date     YYYY-MM-DD  default: tomorrow in Sydney
 *   dry_run  true        report what WOULD be queued; writes nothing
 *   force    true        run even before the configured send hour
 *
 * The send hour comes from MessagingSettings.arrival_send_hour (default 18), so
 * a workflow may run this every hour: before the hour it does nothing, after it
 * every run is idempotent.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const admin = base44.asServiceRole;

    const now = sydneyNow();
    const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : addDays(now.date, 1);
    const sendHour = await getSendHour(admin);

    if (body?.force !== true && !body?.date && now.hour < sendHour) {
      const reason = `Before the ${sendHour}:00 Sydney send time (it is ${now.hour}:00 there).`;
      if (actor.automation) await recordJobRun(admin, 'arrival', { outcome: 'no_op', reason });
      return Response.json({ ok: true, ran: false, reason, send_hour: sendHour, sydney_hour: now.hour });
    }

    const summary = await runArrivalTimes(admin, {
      date,
      dryRun: body?.dry_run === true,
      trigger: actor.automation ? 'scheduled' : 'admin',
    });
    // The night-before reminder for confirmed bookings with no finalised route. It runs an hour AFTER the arrival
    // send hour, so a route finalised at the usual time has already been given its exact arrival message.
    let reminders: any = { ran: false, reason: `Reminders start at ${Math.min(sendHour + 1, 23)}:00 Sydney time.` };
    if (body?.force === true || body?.date || now.hour >= Math.min(sendHour + 1, 23)) {
      try { reminders = { ran: true, ...(await runPreAppointmentReminders(admin, { date, dryRun: body?.dry_run === true })) }; }
      catch (e) { console.error('night-before reminders failed', (e as Error)?.message); reminders = { ran: false, error: 'The reminder step failed.' }; }
    }
    if (actor.automation) {
      const processed = summary.queued + summary.already_queued + summary.skipped_bookings;
      await recordJobRun(admin, 'arrival', {
        outcome: processed > 0 ? 'acted' : 'no_op',
        reason: processed > 0 ? '' : `No bookings on a route for ${date}.`,
        detail: `Service date ${date} · ${summary.queued} newly queued · ${summary.already_queued} already queued · ${reminders.queued || 0} night-before reminders`,
        processed, sent: summary.queued, suppressed: summary.skipped_bookings, failed: 0,
      });
    }
    return Response.json({ ok: true, ran: true, send_hour: sendHour, ...summary, reminders });
  } catch (_error) {
    try {
      const base44 = createClientFromRequest(req);
      if (req.headers.get('x-workflow-run')) await recordJobRun(base44.asServiceRole, 'arrival', { outcome: 'failed', error: 'The arrival-time job failed. See the function logs.' });
    } catch { /* heartbeat is best effort */ }
    return Response.json({ ok: false, error: 'Could not run the arrival-time job.' }, { status: 500 });
  }
}