import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

const REFRESH_MS = 60000;

// The live ETA for one day (from getRouteEta). Refreshes every minute while the tab is visible;
// call refresh() after a stop changes. Test-data routes are left out.
export default function useRouteEta(date) {
  const [routes, setRoutes] = useState([]);

  const refresh = useCallback(() => base44.functions.invoke('getRouteEta', { date })
    .then(res => setRoutes((res.data?.routes || []).filter(r => !r.is_test)))
    .catch(() => setRoutes([])), [date]);

  useEffect(() => {
    setRoutes([]);
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { routes, refresh };
}

// requestId -> the running_late message state for that stop (only stops that have one).
export function lateByRequest(routes) {
  const map = {};
  for (const r of routes) for (const s of r.stops || []) if (s.running_late) map[s.booking_request_id] = s.running_late;
  return map;
}