import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { importSummary } from '../../shared/googleBusyImport.ts';

/**
 * Is the signed-in barber's Google Calendar connected, and how fresh is the busy-time import?
 *
 * The page asks this on open: the answer IS the connection check, so there is no
 * second notion of "connected" to drift out of step. It verifies the connection
 * with Google (one cheap call the granted scope allows) before saying yes, so a
 * revoked or expired grant is reported as not connected rather than shown as fine.
 * A refusal (401) means "not connected" to the page. A Google outage is NOT a
 * disconnection: the answer stays connected (reachable: false) so the stale warning
 * about the held blocks can still be shown.
 *
 * Read-only: it never writes a calendar block and never touches app data. The probe
 * asks Google for the calendar's own name only, never an event.
 */
const CONNECTOR_ID = '6acfeb0637dedce6cedcd553';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;

    let connection: any = null;
    try {
      connection = await admin.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
    } catch {
      return Response.json({ connected: false, error: 'Your Google Calendar is not connected yet.' }, { status: 401 });
    }

    let reachable = true;
    let account: string | null = null;
    try {
      const probe = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=summary', {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
      if (probe.status === 401 || probe.status === 403) {
        return Response.json({ connected: false, error: 'Your Google Calendar needs to be reconnected.' }, { status: 401 });
      }
      if (probe.ok) {
        const data = await probe.json().catch(() => null);
        if (typeof data?.summary === 'string' && data.summary.includes('@')) account = data.summary;
      } else {
        reachable = false;
      }
    } catch {
      reachable = false;
    }

    const synced = await admin.entities.CalendarSync.count({ app_user_id: actor.user.id });
    const summary = await importSummary(admin, actor.user.id, actor.member_id);

    return Response.json({
      connected: true,
      reachable,
      synced_count: Number(synced) || 0,
      barber: actor.member?.name || actor.name,
      import: { ...summary, account: account || summary.account },
    });
  } catch (error) {
    return Response.json({ error: 'Could not check the calendar.' }, { status: 500 });
  }
}