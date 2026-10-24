import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { refundableAmount, toMoney } from '@/lib/paymentOwing';

/**
 * "What happens to the deposit?" — shown whenever the booking being cancelled holds money.
 * The cancellation does not complete until one of the three answers is given:
 * full refund, partial refund (amount), or retained (with a reason). Nothing is calculated from the
 * cancellation policy: it is free text, shown here only as a reminder while the person chooses.
 *
 * Reports { ready, decision, opSeq } upward; renders nothing when no money is held.
 */
const money = (n) => `$${Number(n).toFixed(2)}`;

export default function CancelDepositChoice({ bookingId, onChange }) {
  const [held, setHeld] = useState(null); // null = loading, 0 = nothing held
  const [opSeq, setOpSeq] = useState(0);
  const [policy, setPolicy] = useState('');
  const [kind, setKind] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([
      base44.entities.BookingPayment.filter({ booking_request_id: bookingId }, '-created_date', 1),
      base44.entities.BookingRules.list('-created_date', 1).catch(() => []),
    ]).then(([rows, rules]) => {
      if (!live) return;
      const pay = (Array.isArray(rows) ? rows : rows?.items || [])[0];
      setHeld(pay ? refundableAmount(toMoney(pay)) : 0);
      setOpSeq(pay?.op_seq || 0);
      setPolicy((Array.isArray(rules) ? rules : rules?.items || [])[0]?.cancellation_policy || '');
    }).catch(() => live && setHeld(0));
    return () => { live = false; };
  }, [bookingId]);

  useEffect(() => {
    if (held === null) return onChange({ ready: false, decision: null, opSeq });
    if (held <= 0) return onChange({ ready: true, decision: null, opSeq });
    let decision = null;
    if (kind === 'full') decision = { kind: 'full' };
    if (kind === 'partial' && Number(amount) > 0 && Number(amount) <= held) decision = { kind: 'partial', amount: Number(amount) };
    if (kind === 'retained' && reason.trim().length >= 3) decision = { kind: 'retained', reason: reason.trim() };
    onChange({ ready: !!decision, decision, opSeq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, kind, amount, reason, opSeq]);

  if (!held) return null;

  const option = (key, label) => (
    <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${kind === key ? 'border-red-300 bg-red-50 font-semibold text-red-700' : 'border-zinc-200 bg-white text-zinc-700'}`}>
      <input type="radio" name={`deposit-${bookingId}`} value={key} checked={kind === key} onChange={() => setKind(key)} />
      {label}
    </label>
  );

  return (
    <fieldset className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3" aria-label="What happens to the deposit?">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-amber-800">What happens to the deposit?</legend>
      <p className="text-xs text-zinc-700">This booking holds <strong>{money(held)}</strong>. Choose before cancelling.</p>
      {policy && <p className="text-xs text-zinc-500 whitespace-pre-line"><span className="font-semibold">Cancellation policy:</span> {policy}</p>}
      {option('full', `Full refund (${money(held)})`)}
      {option('partial', 'Partial refund')}
      {kind === 'partial' && <Input type="number" min="0" max={held} placeholder="Amount $" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 h-9" />}
      {option('retained', 'Retained')}
      {kind === 'retained' && <Input placeholder="Reason for keeping it (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" />}
    </fieldset>
  );
}