import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import AdminCard from '@/components/admin/ui/AdminCard';

const call = (dry_run) => base44.functions.invoke('migratePaymentState', { dry_run }).then((r) => r.data);

// Gives bookings that have no payment record one. The preview reads and counts; it never writes.
export default function PaymentRepairPanel({ onDone }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (dry) => {
    setBusy(true); setError(null);
    try {
      const data = await call(dry);
      if (dry) { setPreview(data); setResult(null); } else { setResult(data); setPreview(null); onDone?.(); }
    } catch (e) { setError(e?.response?.data?.error || e?.message || 'That did not work.'); }
    setBusy(false);
  };

  return (
    <AdminCard className="space-y-2">
      <p className="text-sm font-bold text-zinc-900">Repair payment records</p>
      <p className="text-xs text-zinc-500">Finds bookings with no payment record. Preview first: nothing is changed and no customer is texted.</p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(true)}>{busy && !preview ? 'Checking…' : 'Preview'}</Button>
      {preview && (
        <div className="text-xs text-zinc-700 space-y-2">
          <p>{preview.to_migrate === 0 ? 'Every booking already has a payment record.'
            : `${preview.to_migrate} to repair: ${preview.paid_in_full} paid, ${preview.not_required} with no deposit, ${preview.deposit_due} with a deposit due.`}
            {preview.has_more ? ' Only the newest bookings were checked.' : ''}</p>
          {preview.to_migrate > 0 && <Button size="sm" disabled={busy} onClick={() => run(false)}>Repair {preview.to_migrate} bookings</Button>}
        </div>
      )}
      {result && <p className="text-xs text-emerald-700">Done: {result.to_migrate} payment records created. Running it again changes nothing.</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </AdminCard>
  );
}