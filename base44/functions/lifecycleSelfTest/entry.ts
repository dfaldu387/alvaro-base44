import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { normaliseStart, confirmedMoveStarts, windowFor } from '../../shared/bookingLifecycle.ts';

/** Admin-only check of the pure lifecycle-message rules. Reads and writes nothing. */
export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  const actor = await requireAdminActor(base44, req);
  if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

  const cases: Array<[string, boolean]> = [];
  const is = (name: string, ok: boolean) => cases.push([name, ok]);

  is('start normalised', normaliseStart('2026-10-16', '4:30pm') === '2026-10-16T16:30');
  is('same moment, different spelling', normaliseStart('2026-10-16', '16:30') === normaliseStart('2026-10-16', '4:30 PM'));
  is('midnight hour', normaliseStart('2026-10-16', '12:00am') === '2026-10-16T00:00');
  is('bad time -> null', normaliseStart('2026-10-16', 'soon') === null);
  is('bad date -> null', normaliseStart('16/10', '4pm') === null);

  const confirmed = { status: 'confirmed', schedule_status: 'confirmed', requested_date: '2026-10-16', assigned_time: '10:00am' };
  is('confirmed move to new time', confirmedMoveStarts(confirmed, '2026-10-16', '11:00am')?.to === '2026-10-16T11:00');
  is('confirmed move to new date, same time', confirmedMoveStarts(confirmed, '2026-10-23', '10:00am')?.to === '2026-10-23T10:00');
  is('same time again -> no change', confirmedMoveStarts(confirmed, '2026-10-16', '10:00am') === null);
  is('same time, other spelling -> no change', confirmedMoveStarts(confirmed, '2026-10-16', '10:00 AM') === null);
  is('provisional is not customer-facing', confirmedMoveStarts({ ...confirmed, schedule_status: 'provisional' }, '2026-10-16', '11:00am') === null);
  is('locked is not customer-facing', confirmedMoveStarts({ ...confirmed, schedule_status: 'locked' }, '2026-10-16', '11:00am') === null);
  is('unscheduled is not a move', confirmedMoveStarts({ ...confirmed, schedule_status: 'unscheduled', assigned_time: null }, '2026-10-16', '11:00am') === null);
  is('declined is not a move', confirmedMoveStarts({ ...confirmed, status: 'declined' }, '2026-10-16', '11:00am') === null);
  is('no prior time -> no move', confirmedMoveStarts({ ...confirmed, assigned_time: null }, '2026-10-16', '11:00am') === null);

  is('own window used', windowFor({ availability_window: '2pm-7pm' }, '3:00pm') === '2pm-7pm');
  is('flexible falls back to a window from the time', windowFor({ availability_window: 'Flexible' }, '3:00pm') === '3:00pm–5:00pm');
  is('override falls back to a window from the time', windowFor({ availability_window: '2pm-7pm', availability_override: true }, '8:00pm') === '8:00pm–10:00pm');

  return Response.json({ ok: cases.every(c => c[1]), passed: cases.filter(c => c[1]).length, total: cases.length, failed: cases.filter(c => !c[1]).map(c => c[0]) });
}