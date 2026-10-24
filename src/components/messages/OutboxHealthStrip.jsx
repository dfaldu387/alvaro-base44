import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';
import { asList, when } from '@/lib/conversations';

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={cn('text-sm font-bold mt-0.5', tone || 'text-zinc-800')}>{value}</p>
    </div>
  );
}

/** Queue health: last sweep run, pending count, dead-letter count. */
export default function OutboxHealthStrip({ tick }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      base44.entities.OutboxHealth.list('created_date', 1),
      base44.entities.MessageOutbox.count({ status: 'pending' }),
      base44.entities.MessageOutbox.count({ status: 'dead_letter' }),
    ]).then(([health, pending, dead]) => {
      if (live) { setData({ health: asList(health)[0] || null, pending, dead }); setFailed(false); }
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [tick, n]);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Message queue</h2>
        <button onClick={() => setN((x) => x + 1)} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      {failed && <p className="text-xs text-red-600">Could not load the queue status.</p>}
      {!failed && !data && <p className="text-xs text-zinc-400">Loading…</p>}
      {data && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Last sweep run" value={data.health?.last_run_at ? when(data.health.last_run_at) : 'Never'} />
          <Stat label="Pending" value={data.pending} />
          <Stat label="Dead-letter" value={data.dead} tone={data.dead > 0 ? 'text-red-600' : undefined} />
        </div>
      )}
      {data?.health?.last_error && <p className="text-xs text-red-600 mt-2">Last sweep error: {data.health.last_error}</p>}
    </div>
  );
}