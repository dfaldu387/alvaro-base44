import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

const REFRESH_MS = 60000;

// Loads the live tracking view for a link token and refreshes it every minute while the page is open.
// view: null while loading, { available: false, message } when the link is not active.
export default function useTrackingToken(token) {
  const [view, setView] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    const load = () => base44.functions.invoke('getBookingTracking', { token })
      .then(res => { if (!cancelled) setView(res.data || { available: false }); })
      .catch(() => { if (!cancelled) setView({ available: false }); });
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [token]);

  return view;
}