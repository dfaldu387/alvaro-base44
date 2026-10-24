// Which scheduled background jobs are overdue. Pure (no imports), so it is shared by the
// Automation page, the sidebar badge and the top banner, and tested without a browser.
// Only the three scheduled jobs can be "overdue": autoplace and reshuffle run when a
// booking changes, so a quiet day is not a failure for them.

export const STALE_MINUTES = 15;

/** Minutes after which a scheduled job with no run is reported as overdue. */
export const JOB_STALE_MINUTES = { sweep: STALE_MINUTES, arrival: 90, campaign: 25 * 60 };

export const SCHEDULED_JOBS = [
  { key: 'sweep', name: 'Message sweep', consequence: 'Queued messages will not be sent.' },
  { key: 'arrival', name: 'Arrival Times', consequence: 'Arrival-time messages will not be queued.' },
  { key: 'campaign', name: 'Campaign Run', consequence: 'Reminder campaigns will not run.' },
];

/** One honest view of a job: when it last ran, what it did, and whether it is overdue. */
export function jobView(key, data, now = Date.now()) {
  const hb = data.beats?.[key] || null;
  const health = key === 'sweep' ? data.health : null;
  const lastRunAt = hb?.last_run_at || health?.last_run_at || null;
  const age = lastRunAt ? (now - new Date(lastRunAt).getTime()) / 60000 : null;
  const overdue = age === null || age > JOB_STALE_MINUTES[key];
  return {
    hb, lastRunAt, age, overdue, neverRun: !lastRunAt,
    error: hb?.last_error || (key === 'sweep' ? health?.last_error : '') || '',
  };
}

/** What the barber is told when tomorrow's finalised route no longer matches its day. */
export const ROUTE_ALERT = {
  name: "Tomorrow's route has changed.",
  consequence: 'Arrival times will not be sent until you rebuild it.',
};

/** Tomorrow's date (YYYY-MM-DD) on the Sydney wall clock: the day the arrival job works on. */
export function sydneyTomorrow(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(now)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  return d.toISOString().slice(0, 10);
}

/**
 * A banner item (same shape the overdue-job banner and the sidebar badge already use) when the day-route
 * overview says that day's route needs updating, otherwise null. `kind: 'route'` lets the banner word it.
 */
export function staleRouteAlert(overview, date) {
  if (overview?.status !== 'needs_update') return null;
  return { key: `route:${date}`, kind: 'route', date, ...ROUTE_ALERT };
}

/** The scheduled jobs that are overdue right now, each with its view. */
export function overdueJobs(data, now = Date.now()) {
  return SCHEDULED_JOBS
    .map((job) => ({ ...job, view: jobView(job.key, data, now) }))
    .filter((j) => j.view.overdue);
}