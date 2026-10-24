import React from 'react';
import AdminCard from '@/components/admin/ui/AdminCard';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import PaymentActions from '@/components/payments/PaymentActions';
import PaymentHistory from '@/components/payments/PaymentHistory';
import { STATE_LABELS, money } from '@/lib/paymentApi';
import { amountOwing, toMoney } from '@/lib/paymentOwing';

const tone = (s) => ({
  deposit_due: 'warning', paid_in_full: 'success', deposit_paid: 'success', balance_due: 'warning',
}[s] || 'neutral');

function linkStatus(pay) {
  if (!pay.payment_link_url) return 'No link';
  const expired = pay.payment_link_expires_at && new Date(pay.payment_link_expires_at) < new Date();
  return `${pay.is_simulated ? 'SIMULATED link' : 'Link'} · ${expired ? 'expired' : 'active'}`;
}

export default function PaymentCard({ pay, booking, allowWaive, onDone }) {
  // The one answer to "what is owed" (a copy of the server's amountOwing, tested equal). The card does no arithmetic.
  const owing = amountOwing(toMoney(pay));
  return (
    <AdminCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900">{booking?.client_name || 'Booking'}</p>
          <p className="text-xs text-zinc-500">{booking?.requested_date || booking?.day} · {(booking?.services || []).join(', ')}</p>
        </div>
        <StatusBadge tone={tone(pay.state)} className="shrink-0">{STATE_LABELS[pay.state] || pay.state}</StatusBadge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <Fig label="Total" v={money(pay.total_amount)} />
        <Fig label="Deposit" v={pay.deposit_amount > 0 ? money(pay.deposit_amount) : pay.deposit_waived ? 'Waived' : '—'} />
        <Fig label="Paid" v={money(pay.amount_paid)} />
        <Fig label="Owing" v={money(owing)} />
        <Fig label="Refunded" v={money(pay.amount_refunded)} />
      </div>
      <p className="text-xs text-zinc-600">
        <span className="font-semibold">Link:</span> {linkStatus(pay)}
        {pay.deposit_reason && <> · <span className="font-semibold">Why:</span> {pay.deposit_reason}</>}
        {pay.deposit_waived && <> · <span className="font-semibold">Waived by {pay.waived_by}:</span> {pay.waive_reason}</>}
      </p>
      {/* The customer normally gets this by text. Until a number is connected there is no
          other way to reach the provider's checkout page, and an admin reading the link out
          or re-sending it by hand is a real need anyway. A simulated link goes nowhere, so
          it is shown as text rather than offered as something to open. */}
      {pay.payment_link_url && (
        pay.is_simulated ? (
          <p className="break-all font-mono text-[11px] text-zinc-500">{pay.payment_link_url}</p>
        ) : (
          <a
            href={pay.payment_link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-all font-mono text-[11px] text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
          >
            {pay.payment_link_url}
          </a>
        )
      )}
      {pay.needs_attention && (
        <p role="alert" className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-2 break-words">
          <span className="font-semibold">Needs action:</span> {pay.attention_reason || 'The customer has not been asked for this money.'}
        </p>
      )}
      {pay.is_simulated && <StatusBadge tone="test">SIMULATED: test payment system, no real money moved.</StatusBadge>}
      <PaymentActions pay={pay} bookingId={pay.booking_request_id} allowWaive={allowWaive} onDone={onDone} />
      <PaymentHistory bookingId={pay.booking_request_id} />
    </AdminCard>
  );
}

const Fig = ({ label, v }) => (
  <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-2 py-1.5">
    <p className="text-zinc-500">{label}</p><p className="font-semibold text-zinc-900">{v}</p>
  </div>
);