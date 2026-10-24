import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { paymentAction, routePayment } from '@/lib/paymentApi';
import { amountOwing, refundableAmount, toMoney, REFUND_OUTCOME_LABELS } from '@/lib/paymentOwing';

const METHODS = ['Cash', 'Transfer', 'Card'];

// Admin actions for one booking. Each one is a gated server call; the page reloads from the result.
export default function PaymentActions({ pay, bookingId, allowWaive, onDone }) {
  const [mode, setMode] = useState(null); // 'waive' | 'refund' | 'write_off'
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [outcome, setOutcome] = useState(''); // a refund asks what it means: no default
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const run = async (action, extra) => {
    setBusy(true); setError(null);
    // The server compares this with the payment as it now stands: a repeat of something already handled is refused.
    const res = await paymentAction(action, bookingId, { ...extra, expected_op_seq: pay.op_seq || 0 });
    setBusy(false);
    if (!res.ok) { onDone(); return setError(res.error); }
    setMode(null); setReason(''); setAmount(''); setOutcome('');
    if (res.cancel_error) setError(`Refunded, but the booking could not be cancelled: ${res.cancel_error}`);
    onDone();
  };

  // Make the link and text it to the customer: the same text that goes out automatically, sent at most once.
  const sendLink = async () => {
    setBusy(true); setError(null); setNote(null);
    const res = await routePayment('send_link', bookingId);
    setBusy(false);
    if (!res.ok) setError(res.error); else setNote(res.already ? 'That text has already been queued or sent.' : 'Payment link text queued.');
    onDone();
  };

  const money = toMoney(pay);
  const owes = amountOwing(money) > 0;
  const canRefund = refundableAmount(money) > 0;
  const refundReady = mode !== 'refund' || (outcome && Number(amount) > 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {owes && METHODS.map((m) => (
          <Button key={m} size="sm" variant="outline" disabled={busy} onClick={() => run('mark_received', { method: m })}>Received · {m}</Button>
        ))}
        {owes && <Button size="sm" disabled={busy} onClick={sendLink}>Text payment link</Button>}
        {owes && <Button size="sm" variant="outline" disabled={busy} onClick={() => run('request_link')}>Request payment link (test)</Button>}
        {pay.payment_link_url && owes && <Button size="sm" variant="outline" disabled={busy} onClick={() => run('simulate_provider_payment')}>Simulate customer paying (test)</Button>}
        {pay.state === 'deposit_due' && allowWaive && <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('waive')}>Waive deposit</Button>}
        {canRefund && <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('refund')}>Record refund</Button>}
        {owes && <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('write_off')}>Write off</Button>}
        {pay.state === 'refund_pending' && <Button size="sm" variant="outline" disabled={busy} onClick={() => run('resolve_refund')}>Mark refund paid out</Button>}
      </div>
      {mode && (
        <div className="space-y-2">
          {mode === 'refund' && (
            <fieldset className="space-y-1.5" aria-label="What does this refund mean?">
              <legend className="text-xs font-semibold text-zinc-700">What does this refund mean?</legend>
              {Object.entries(REFUND_OUTCOME_LABELS).map(([key, label]) => (
                <label key={key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${outcome === key ? 'border-indigo-400 bg-indigo-50' : 'border-zinc-200 bg-white'}`}>
                  <input type="radio" name={`refund-outcome-${bookingId}`} value={key} checked={outcome === key} onChange={() => setOutcome(key)} />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'refund' && <Input type="number" min="0" placeholder="Amount $" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 h-9" />}
            <Input placeholder={mode === 'waive' ? 'Reason for waiving (required)' : mode === 'write_off' ? 'Reason for writing off (required)' : 'Reason for refund (required)'} value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1 min-w-[200px] h-9" />
            <Button size="sm" disabled={busy || reason.trim().length < 3 || !refundReady} onClick={() => run(mode, mode === 'refund' ? { reason, amount: Number(amount), outcome } : { reason })}>Confirm</Button>
            <Button size="sm" variant="ghost" onClick={() => { setMode(null); setError(null); setOutcome(''); }}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {note && <p className="text-xs text-emerald-700">{note}</p>}
    </div>
  );
}