import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { classifyArrivalReply } from '../../shared/arrivalReplies.ts';
import { arrivalKey, addDays, sydneyNow } from '../../shared/arrivalTimes.ts';

/** Admin-only check of the pure Day 3 rules. Reads and writes nothing. */
export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  const actor = await requireAdminActor(base44, req);
  if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

  const cases: Array<[string, boolean]> = [];
  const is = (name: string, ok: boolean) => cases.push([name, ok]);

  for (const t of ['YES', ' yes ', 'y', 'Yep', 'CONFIRM', '\nConfirm\n']) is(`confirm: "${t.trim()}"`, classifyArrivalReply(t) === 'customer_confirmed');
  for (const t of ['NO', ' no', 'Cancel', 'RESCHEDULE', 'reschedule ']) is(`attention: "${t.trim()}"`, classifyArrivalReply(t) === 'needs_attention');
  for (const t of ['yes please', 'Thanks!', 'nope', '', 'what time?', 'STOP']) is(`other: "${t}"`, classifyArrivalReply(t) === 'other');
  is('non-string is other', classifyArrivalReply(undefined) === 'other');

  is('key format', arrivalKey('abc', '2026-10-14') === 'sms|abc|arrival_time|2026-10-14');
  is('date add across month', addDays('2026-10-31', 1) === '2026-11-01');
  is('date add across year', addDays('2026-12-31', 1) === '2027-01-01');
  // 2026-10-13 13:30 UTC is 00:30 on 14 Oct in Sydney (daylight time, UTC+11).
  is('sydney date past UTC midnight', sydneyNow(new Date('2026-10-13T13:30:00Z')).date === '2026-10-14');
  is('sydney hour', sydneyNow(new Date('2026-10-13T07:05:00Z')).hour === 18);

  return Response.json({ ok: cases.every(c => c[1]), passed: cases.filter(c => c[1]).length, total: cases.length, failed: cases.filter(c => !c[1]).map(c => c[0]) });
}