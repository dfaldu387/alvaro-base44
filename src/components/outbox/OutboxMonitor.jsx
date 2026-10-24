import React, { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';
import OutboxDeadLetterList from '@/components/outbox/OutboxDeadLetterList';

const asList = (r) => (Array.isArray(r) ? r : (r?.items || []));
const when = (v) => (v ? format(new Date(v), 'd MMM, h:mm:ss a') : 'Never');

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={cn('text-sm font-bold mt-1', tone || 'text-zinc-800')}>{value}</p>
    </div>
  );
}

export default function OutboxMonitor() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [health, pending, claimed, dead, deadItems] = await Promise.all([
        base44.entities.OutboxHealth.list('created_date', 1),
        base44.entities.MessageOutbox.count({ status: 'pending' }),
        base44.entities.MessageOutbox.count({ status: 'claimed' }),
        base44.entities.MessageOutbox.count({ status: 'dead_letter' }),
        base44.entities.MessageOutbox.filter({ status: 'dead_letter' }, '-updated_date', 10),
      ]);
      setData({ health: asList(health)[0] || null, pending, claimed, dead, deadItems: asList(deadItems) });
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const h = data?.health;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-zinc-900">Message queue (background sweep)</h2>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          <span className="font-bold">Check the mode.</span> Unless live messaging is switched on, "Sent" means the test
          sender reported success and nothing was delivered. When live, "Sent" means Twilio accepted the message, and
          it counts as delivered only after Twilio's status callback arrives.
        </p>
      </div>

      {failed && <p className="text-xs text-red-600">Could not load the queue status.</p>}
      {!failed && !data && <p className="text-xs text-zinc-400">Loading…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <Stat label="Last sweep run" value={when(h?.last_run_at)} />
            <Stat label="Last successful sweep" value={when(h?.last_successful_at)} />
            <Stat label="Pending" value={data.pending} />
            <Stat label="Claimed" value={data.claimed} />
            <Stat label="Dead-letter" value={data.dead} tone={data.dead > 0 ? 'text-red-600' : undefined} />
            <Stat label="Sent, last run" value={h?.items_sent_last_run ?? 0} />
            <Stat label="Consecutive sweep failures" value={h?.consecutive_failures ?? 0} tone={(h?.consecutive_failures || 0) > 0 ? 'text-red-600' : undefined} />
          </div>
          {h?.last_error && <p className="text-xs text-red-600 mb-3">Last sweep error: {h.last_error}</p>}
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">Dead-lettered items</p>
          <OutboxDeadLetterList items={data.deadItems} onChanged={load} />
        </>
      )}
    </div>
  );
}