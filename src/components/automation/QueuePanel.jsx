import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { FILTERS, loadQueuePage } from '@/lib/automation';
import QueueRow from '@/components/automation/QueueRow';

export default function QueuePanel({ tick }) {
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ items: [], messages: {}, clients: {}, next: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (more) => {
    setLoading(true); setError(false);
    try {
      const p = await loadQueuePage(filter, more ? state.next : null);
      setState((s) => more
        ? { items: [...s.items, ...p.items], messages: { ...s.messages, ...p.messages }, clients: { ...s.clients, ...p.clients }, next: p.next }
        : p);
    } catch { setError(true); }
    setLoading(false);
  }, [filter, state.next]);

  // Reload from the first page whenever the filter changes or the page is refreshed.
  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, tick]);

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Message queue</h2>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-semibold', filter === f.key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 bg-white text-zinc-700')}>
            {f.label}
          </button>
        ))}
      </div>
      {filter === 'delivered' && <p className="text-[11px] text-zinc-500">Only items whose provider status callback reported delivered. Simulated sends are never listed here.</p>}
      {error && <p className="text-xs text-red-600">Could not load the queue. {state.items.length > 0 ? 'The list below may be out of date.' : ''}</p>}
      {!error && !loading && state.items.length === 0 && <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500">No messages match this filter.</p>}
      <ul className="space-y-2">
        {state.items.map((o) => <QueueRow key={o.id} o={o} msg={state.messages[o.id]} client={state.clients[o.client_id]} />)}
      </ul>
      {loading && <p className="text-xs text-zinc-400">Loading…</p>}
      {!loading && state.next && (
        <button onClick={() => load(true)} className="w-full rounded-lg border border-zinc-300 bg-white py-2 text-xs font-semibold text-zinc-700">Load more</button>
      )}
    </section>
  );
}