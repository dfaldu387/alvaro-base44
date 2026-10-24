/**
 * A version stamp for one calendar day: every booking's id, time, schedule state, status and last-update
 * time. Same shape as the stamp the day optimiser takes (routeFlowOptimiser.loadDay), but it needs nothing
 * else to be loadable (no travel lookup), so it can guard a write even when the optimiser could not run.
 * If the stamp read before the checks differs from the one read just before saving, the day changed
 * underneath and nothing is written.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export function dayVersionOf(rows: any[]): string {
  return rows
    .map((r: any) => `${r.id}:${r.assigned_time || ''}:${r.schedule_status || ''}:${r.status || ''}:${r.updated_date || ''}`)
    .sort()
    .join('|');
}

export async function readDayVersion(admin: any, date: string): Promise<string> {
  return dayVersionOf(asList(await admin.entities.BookingRequest.filter({ requested_date: date }, '-created_date', 300)));
}