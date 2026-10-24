import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw } from 'lucide-react';
import { loadRouteFlowActivity } from '@/lib/routeFlowActivity';
import ActivityFilterBar from '@/components/routeflow/ActivityFilterBar';
import ActivityCard from '@/components/routeflow/ActivityCard';
import { cn } from '@/lib/utils';

/**
 * Route Flow → Activity. Everything Route Flow has done in the background, on
 * its own or with an admin, with the reason behind it — newest first.
 */
export default function RouteFlowActivity() {
  const [category, setCategory] = useState('all');
  const [date, setDate] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setItems(await loadRouteFlowActivity(base44, { category, date }));
    } catch {
      setItems([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [category, date, reloadKey]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Activity</h2>
          <p className="text-xs text-zinc-500 mt-1 max-w-xl leading-relaxed">
            What Route Flow has done in the background — placements, reshuffles, requests it could not
            place, and the reason behind each one. Newest first.
          </p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 border border-zinc-200 bg-white hover:border-zinc-300 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      <ActivityFilterBar
        category={category}
        onCategory={(value) => { setCategory(value); setExpandedId(null); }}
        date={date}
        onDate={(value) => { setDate(value); setExpandedId(null); }}
        count={items.length}
        loading={loading}
      />

      <div className="mt-4 space-y-3">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 text-[#6366F1] animate-spin" />
          </div>
        ) : failed ? (
          <Notice title="Activity could not be loaded" text="Refresh in a moment to try again." />
        ) : items.length === 0 ? (
          <Notice
            title="No activity for this filter"
            text="Route Flow records every placement, reshuffle and skip here — including the ones that happened while this page was closed."
          />
        ) : (
          items.map((item) => (
            <ActivityCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Notice({ title, text }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-zinc-600">{title}</p>
      <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto leading-relaxed">{text}</p>
    </div>
  );
}