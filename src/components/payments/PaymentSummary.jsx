import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import AdminCard from '@/components/admin/ui/AdminCard';
import { money } from '@/lib/paymentApi';
import { summarise } from '@/lib/paymentOwing';

// One server-side total per payment state; the tiles are worked out from those, never from a loaded list.
export default function PaymentSummary({ refreshKey }) {
  const [s, setS] = useState(null);

  useEffect(() => {
    const sum = ['total_amount', 'deposit_amount', 'amount_paid', 'amount_refunded'];
    const live = { is_test: { $ne: true } };
    // The second total is the refunded subset. A refund that kept the appointment sits in
    // deposit_due owing the whole amount, and a per-state sum cannot tell it from an unpaid
    // deposit — so the tiles need both. Subtracting one from the other is exact and avoids
    // guessing how the query engine treats a missing amount_refunded.
    Promise.all([
      base44.entities.BookingPayment.aggregate({ query: live, groupBy: 'state', sum }),
      base44.entities.BookingPayment.aggregate({ query: { ...live, amount_refunded: { $gt: 0 } }, groupBy: 'state', sum }),
    ])
      .then(([all, refunded]) => setS(summarise(all?.rows || [], refunded?.rows || [])))
      .catch(() => setS(null));
  }, [refreshKey]);

  const tiles = [
    ['Expected revenue', s?.expected], ['Collected', s?.collected],
    ['Outstanding deposits', s?.outstandingDeposits], ['Outstanding balances', s?.outstandingBalances],
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map(([label, v]) => (
        <AdminCard key={label}>
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="text-xl font-bold text-zinc-900 mt-1">{s ? money(v) : '—'}</p>
        </AdminCard>
      ))}
    </div>
  );
}