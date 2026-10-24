import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { overdueJobs, staleRouteAlert, sydneyTomorrow } from '@/lib/jobOverdue';
import { loadDayRouteState } from '@/lib/dayRouteStatus';

const asList = (r) => (Array.isArray(r) ? r : (r?.items || []));

/**
 * The warnings for the admin banner and sidebar badge, re-checked every minute: scheduled jobs that are overdue,
 * and tomorrow's route when it no longer matches its day (arrival texts are refused then). Both are checked here,
 * on every admin page, so nobody has to open the calendar first. Empty while loading or if a check fails.
 */
export default function useOverdueJobs() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      let late = [];
      let route = null;
      try {
        const [health, beats] = await Promise.all([
          base44.entities.OutboxHealth.list('-created_date', 1),
          base44.entities.JobHeartbeat.list('-created_date', 20),
        ]);
        late = overdueJobs({ health: asList(health)[0] || null, beats: Object.fromEntries(asList(beats).map((b) => [b.job_key, b])) });
      } catch { /* a failed check shows nothing rather than a false alarm */ }
      try {
        const date = sydneyTomorrow();
        route = staleRouteAlert(await loadDayRouteState(date), date);
      } catch { /* same */ }
      if (live) setJobs([...(route ? [route] : []), ...late]);
    };
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return jobs;
}