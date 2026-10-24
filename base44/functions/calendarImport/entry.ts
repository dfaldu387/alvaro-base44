import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { getState, runImport, removeAllOwnBlocks, importSummary, throttled } from '../../shared/googleBusyImport.ts';

/**
 * Google Calendar as an availability source: sync, switch, setting.
 *
 * Reads the SIGNED-IN person's own Google Calendar through the same per-user connection
 * syncRouteToCalendar uses (no new consent, no shared connection) and keeps block rows
 * for the time that is genuinely busy. See shared/googleBusyImport.ts for every rule.
 *
 * body.action:
 *   'sync'  — "Sync now". Runs when the switch is on.
 *   'auto'  — opening an availability page. Same, but at most once per 15 minutes per user.
 *   'set'   — { enabled?, include_all_day? }. Turning off removes the sync's own blocks;
 *             turning on (or changing the all-day setting) syncs again.
 *
 * Admin or staff only: the caller is resolved before ANY read of Google or the database.
 * Nothing here sends a message or moves a booking.
 */
const CONNECTOR_ID = '6acfeb0637dedce6cedcd553';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) {
      return Response.json({ error: 'Only a signed-in person can read their own calendar.' }, { status: 403 });
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const action = String(body?.action || 'sync');
    if (!['sync', 'auto', 'set'].includes(action)) {
      return Response.json({ error: 'Unknown action.' }, { status: 400 });
    }

    const admin = base44.asServiceRole;
    const userId = actor.user.id;
    const state = await getState(admin, userId);

    let resync = action !== 'set';
    let removed = 0;
    if (action === 'set') {
      const patch: any = {};
      if (typeof body.include_all_day === 'boolean' && body.include_all_day !== !!state.include_all_day) {
        patch.include_all_day = body.include_all_day;
        resync = !!state.enabled || body.enabled === true;
      }
      if (typeof body.enabled === 'boolean' && body.enabled !== !!state.enabled) {
        patch.enabled = body.enabled;
        if (body.enabled) {
          resync = true;
        } else {
          removed = await removeAllOwnBlocks(admin, userId);
          Object.assign(patch, { stale: false, last_error: null, consecutive_failures: 0 });
          resync = false;
        }
      }
      if (Object.keys(patch).length) {
        await admin.entities.CalendarImportState.update(state.id, patch);
        Object.assign(state, patch);
      }
    }

    let ran: any = null;
    let skipped: string | null = null;
    if (resync) {
      if (!state.enabled) skipped = 'off';
      else if (action === 'auto' && throttled(state)) skipped = 'throttled';
      else {
        let accessToken: string | null = null;
        try {
          accessToken = (await admin.connectors.getCurrentAppUserConnection(CONNECTOR_ID))?.accessToken || null;
        } catch {
          accessToken = null;
        }
        if (!accessToken) {
          const patch = {
            last_attempt_at: new Date().toISOString(), stale: true, last_error: 'not_connected',
            failure_count: (Number(state.failure_count) || 0) + 1,
            consecutive_failures: (Number(state.consecutive_failures) || 0) + 1,
          };
          await admin.entities.CalendarImportState.update(state.id, patch);
          Object.assign(state, patch);
          ran = { ok: false, error: 'not_connected', added: 0, updated: 0, removed: 0, stale: true };
        } else {
          ran = await runImport({ admin, accessToken, userId, state, memberId: actor.member_id });
        }
      }
    }

    const summary = await importSummary(admin, userId, actor.member_id);
    return Response.json({ ...summary, ran: !!ran, skipped, ok: ran ? ran.ok : true, error: ran?.error || null, added: ran?.added || 0, updated: ran?.updated || 0, removed: (ran?.removed || 0) + removed });
  } catch (error) {
    // Fixed text only: an error from Google must never carry event content into a response or a log.
    console.error('[calendarImport] failed');
    return Response.json({ error: 'The calendar sync could not run.' }, { status: 500 });
  }
}