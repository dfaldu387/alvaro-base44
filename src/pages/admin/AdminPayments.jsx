import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import AdminPage from '@/components/admin/ui/AdminPage';
import ErrorState from '@/components/states/ErrorState';
import { Button } from '@/components/ui/button';
import PaymentSummary from '@/components/payments/PaymentSummary';
import PaymentCard from '@/components/payments/PaymentCard';
import PaymentsHealthPanel from '@/components/payments/PaymentsHealthPanel';
import PaymentRepairPanel from '@/components/payments/PaymentRepairPanel';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);

// Read-only view of payment state. Every change is a gated server call (paymentAction).
export default function AdminPayments() {
  const [rows, setRows] = useState(null);
  const [bookings, setBookings] = useState({});
  const [allowWaive, setAllowWaive] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [attentionCount, setAttentionCount] = useState(0);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([
      base44.entities.BookingPayment.filter({ is_test: { $ne: true }, ...(onlyAttention ? { needs_attention: true } : {}) }, { sort: '-created_date', limit: 100 }),
      base44.entities.DepositRules.list('-created_date', 1),
      base44.entities.BookingPayment.count({ is_test: { $ne: true }, needs_attention: true }),
    ]).then(async ([page, rules, needing]) => {
      const pays = asList(page);
      setAllowWaive(asList(rules)[0]?.allow_waive !== false);
      setAttentionCount(Number(needing) || 0);
      const ids = pays.map((p) => p.booking_request_id);
      const bk = ids.length ? asList(await base44.entities.BookingRequest.filter({ id: { $in: ids } }, { limit: 100 })) : [];
      setBookings(Object.fromEntries(bk.map((b) => [b.id, b])));
      setRows(pays);
    }).catch(() => setFailed(true));
  }, [onlyAttention]);
  useEffect(() => { load(); }, [load, tick]);

  const done = () => setTick((t) => t + 1);

  return (
    <AdminPage title="Payments" subtitle="What is owed, what was paid, and why a deposit was asked for.">
      <PaymentsHealthPanel />
      <PaymentSummary refreshKey={tick} />
      <PaymentRepairPanel onDone={done} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={onlyAttention ? 'outline' : 'default'} onClick={() => setOnlyAttention(false)}>All payments</Button>
        <Button size="sm" variant={onlyAttention ? 'default' : 'outline'} onClick={() => setOnlyAttention(true)}>Needs action ({attentionCount})</Button>
      </div>
      {failed ? (
        <ErrorState title="Couldn't load payments" description="Please try again." onRetry={load} />
      ) : !rows ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{onlyAttention ? 'Nothing needs action right now.' : 'No payment records yet. They are created when a booking is added.'}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => <PaymentCard key={p.id} pay={p} booking={bookings[p.booking_request_id]} allowWaive={allowWaive} onDone={done} />)}
        </div>
      )}
    </AdminPage>
  );
}