import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { transition } from '../../shared/routeStopStates.ts';
import { completionPayload, nextReminderFor } from '../../shared/routeCompletion.ts';

/** routeStopSelfTest — pure checks of stop ordering and completion wording. Writes nothing. */
export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  const actor = await requireAdminActor(base44, req);
  if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

  const results: { name: string; pass: boolean; got?: unknown }[] = [];
  const check = (name: string, got: unknown, want: unknown) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(pass ? { name, pass } : { name, pass, got });
  };
  const t = (s: unknown, a: any, r?: string) => { const x: any = transition(s, a, r); return x.ok ? [x.state, x.already] : [x.code]; };

  check('old stop (no state) can arrive', t(undefined, 'arrive'), ['arrived', false]);
  check('arrive twice changes nothing', t('arrived', 'arrive'), ['arrived', true]);
  check('start needs arrived', t('on_the_way', 'start'), ['NOT_ARRIVED']);
  check('start after arrived', t('arrived', 'start'), ['in_service', false]);
  check('cannot complete a stop never started', t('arrived', 'complete'), ['NOT_STARTED']);
  check('cannot complete from planned', t('planned', 'complete'), ['NOT_STARTED']);
  check('complete after start', t('in_service', 'complete'), ['completed', false]);
  check('complete twice changes nothing', t('completed', 'complete'), ['completed', true]);
  check('on the way from planned', t('planned', 'on_the_way'), ['on_the_way', false]);
  check('on the way after arriving is a no-op', t('arrived', 'on_the_way'), ['arrived', true]);
  check('skip needs a reason', t('planned', 'skip'), ['REASON_REQUIRED']);
  check('emergency skip from any live state', t('in_service', 'skip', 'Client not home'), ['skipped', false]);
  check('cannot skip a completed stop', t('completed', 'skip', 'x'), ['ALREADY_COMPLETED']);
  check('skipped stop cannot arrive', t('skipped', 'arrive'), ['STOP_SKIPPED']);
  check('unknown state is treated as planned', t('banana', 'arrive'), ['arrived', false]);

  check('owing wording', completionPayload({ client_name: 'James Smith', services: ['Skin Fade'], price: 45, payment_status: 'Unpaid' }),
    { name: 'James', service: 'Skin Fade', payment_line: 'Amount owing: $45.' });
  check('paid wording', completionPayload({ client_name: 'James', services: ['Cut', 'Beard'], price: 60.5, payment_status: 'Paid' }).payment_line, 'Paid $60.50, thank you.');
  check('no service falls back', completionPayload({ client_name: 'A', price: 0 }).service, 'haircut');
  check('next reminder fortnightly', nextReminderFor({ frequency: 'Fortnightly' }, '2026-10-14'), '2026-10-28');
  check('next reminder custom days', nextReminderFor({ frequency: 'Custom', custom_frequency_days: 10 }, '2026-10-14'), '2026-10-24');
  check('whenever has no next date', nextReminderFor({ frequency: 'Whenever' }, '2026-10-14'), null);

  const failed = results.filter((r) => !r.pass);
  return Response.json({ total: results.length, passed: results.length - failed.length, failed });
}