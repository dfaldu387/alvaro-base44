import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { evaluateDeposit } from '../../shared/depositRules.ts';
import { getPaymentProvider } from '../../shared/paymentProvider.ts';
import { amountOwing, canRequestLink, receivePayment, recordRefund, waiveDeposit, type Money } from '../../shared/paymentState.ts';

/** depositSelfTest — pure checks of the deposit rules engine and payment state machine. Writes nothing. */
export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  const actor = await requireAdminActor(base44, req);
  if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

  const results: { name: string; pass: boolean; got?: any }[] = [];
  const check = (name: string, got: any, want: any) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push({ name, pass, ...(pass ? {} : { got }) });
  };
  const base = { price: 80, people: 1, isNewClient: false, noShowCount: 0, isAfterHours: false };
  const on = { enabled: true, deposit_type: 'fixed' as const, deposit_amount: 15, group_min_people: 4, min_no_shows: 2, no_show_deposit_amount: 30, new_client_deposit_amount: 20, after_hours_deposit_amount: 25 };

  // Rules engine
  check('no rules saved -> not required', evaluateDeposit({ ...base, isNewClient: true }, null).required, false);
  check('master switch off -> not required', evaluateDeposit({ ...base, isNewClient: true }, { ...on, enabled: false }).required, false);
  check('regular client, normal hours -> not required (no rule fires)', evaluateDeposit(base, on).required, false);
  const nc = evaluateDeposit({ ...base, isNewClient: true }, on);
  check('new client -> $20, rule new_client, plain reason', [nc.required, nc.amount, nc.rules, nc.reason_text], [true, 20, ['new_client'], 'Deposit required: $20.00, new client.']);
  check('new-client amount $0 -> asks nothing', evaluateDeposit({ ...base, isNewClient: true }, { ...on, new_client_deposit_amount: 0 }).required, false);
  check('after hours -> $25', evaluateDeposit({ ...base, isAfterHours: true }, on).amount, 25);
  check('1 no-show, threshold 2 -> not required', evaluateDeposit({ ...base, noShowCount: 1 }, on).required, false);
  const ns = evaluateDeposit({ ...base, noShowCount: 2 }, on);
  check('2 no-shows reach threshold -> $30, rule no_shows', [ns.amount, ns.rules], [30, ['no_shows']]);
  check('no-show threshold 0 = off', evaluateDeposit({ ...base, noShowCount: 9 }, { ...on, min_no_shows: 0 }).required, false);
  check('group of 4 -> fixed $15', evaluateDeposit({ ...base, people: 4 }, on).amount, 15);
  check('group of 3 below minimum -> not required', evaluateDeposit({ ...base, people: 3 }, on).required, false);
  check('group percentage 25% of $80 = $20', evaluateDeposit({ ...base, people: 4 }, { ...on, deposit_type: 'percentage', deposit_amount: 25 }).amount, 20);
  check('several rules: largest applies, all named', [evaluateDeposit({ ...base, isNewClient: true, isAfterHours: true, noShowCount: 2 }, on).amount, evaluateDeposit({ ...base, isNewClient: true, isAfterHours: true, noShowCount: 2 }, on).rules.length], [30, 3]);
  check('deposit capped at price', evaluateDeposit({ ...base, price: 15, isNewClient: true }, on).amount, 15);
  check('test booking never needs deposit', evaluateDeposit({ ...base, isNewClient: true, isTest: true }, on).required, false);

  // State machine
  const due: Money = { state: 'deposit_due', total_amount: 80, deposit_amount: 20, amount_paid: 0, amount_refunded: 0 };
  check('owing on deposit_due = deposit', amountOwing(due), 20);
  const dp = receivePayment(due, 20);
  check('deposit received -> deposit_paid', dp.ok && dp.next.state, 'deposit_paid');
  const full = dp.ok ? receivePayment({ ...due, ...dp.next } as Money, 60) : null;
  check('balance received -> paid_in_full', full?.ok && full.next.state, 'paid_in_full');
  check('overpayment refused', receivePayment(due, 500).ok, false);
  check('waive needs a reason', waiveDeposit(due, '  ', true).ok, false);
  check('waive refused when switched off', waiveDeposit(due, 'regular', false).ok, false);
  const wv = waiveDeposit(due, 'Long-time regular', true);
  check('waive -> not_required, deposit 0', wv.ok && [wv.next.state, wv.next.deposit_amount], ['not_required', 0]);
  const paid: Money = { state: 'paid_in_full', total_amount: 80, deposit_amount: 20, amount_paid: 80, amount_refunded: 0 };
  const part = recordRefund(paid, 30, 'succeeded', 'Service issue');
  check('partial refund -> partially_refunded', part.ok && part.next.state, 'partially_refunded');
  check('full refund -> refunded', (() => { const r = recordRefund(paid, 80, 'succeeded', 'Cancelled'); return r.ok && r.next.state; })(), 'refunded');
  check('pending provider refund -> refund_pending', (() => { const r = recordRefund(paid, 10, 'pending', 'Cancelled'); return r.ok && r.next.state; })(), 'refund_pending');
  check('refund beyond paid refused', recordRefund(paid, 81, 'succeeded', 'x y z').ok, false);
  check('refund needs a reason', recordRefund(paid, 10, 'succeeded', '').ok, false);
  check('no link when nothing owing', canRequestLink(paid).ok, false);
  check('no payment on a refunded booking', receivePayment({ ...paid, state: 'refunded' }, 5).ok, false);

  // Provider seam: the test double is labelled and moves nothing
  const provider = getPaymentProvider();
  const link = await provider.createPaymentLink({ bookingId: 'b1', amount: 20, currency: 'AUD', description: 'Deposit', expiresInHours: 24 });
  check('provider is the simulated test double', [provider.name, provider.simulated, link.simulated], ['test_double', true, true]);
  check('simulated link is unmistakable', [link.providerPaymentId.startsWith('SIMULATED'), link.url.includes('SIMULATED'), link.wouldHaveDone.startsWith('SIMULATED')], [true, true, true]);

  const failed = results.filter((r) => !r.pass);
  return Response.json({ total: results.length, passed: results.length - failed.length, failed });
}