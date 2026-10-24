import { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { asList } from '@/lib/assistant';

/**
 * Assistant events for a query (open inbox items, or one client's history), with
 * the client names they refer to. Refreshes itself when events change.
 */
export default function useAssistantEvents(query, limit = 50) {
  const key = JSON.stringify(query);
  const [state, setState] = useState({ events: [], names: {}, loading: true, error: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const events = asList(await base44.entities.AssistantEvent.filter(JSON.parse(key), { sort: '-created_date', limit }));
        const ids = [...new Set(events.map((e) => e.client_id).filter(Boolean))];
        const rows = ids.length ? asList(await base44.entities.ReminderClient.filter({ id: { $in: ids } }, { limit: ids.length, fields: ['client_name'] })) : [];
        if (live) setState({ events, names: Object.fromEntries(rows.map((c) => [c.id, c.client_name])), loading: false, error: false });
      } catch {
        if (live) setState((s) => ({ ...s, loading: false, error: true }));
      }
    })();
    return () => { live = false; };
  }, [key, limit, tick]);

  useEffect(() => {
    let t;
    const off = base44.entities.AssistantEvent.subscribe(() => { clearTimeout(t); t = setTimeout(reload, 500); });
    return () => { off(); clearTimeout(t); };
  }, [reload]);

  return { ...state, reload };
}