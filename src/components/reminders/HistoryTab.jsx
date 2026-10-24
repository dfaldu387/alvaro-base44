import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { History } from 'lucide-react';
import ErrorState from '@/components/states/ErrorState';
import EmptyState from '@/components/states/EmptyState';
import { cn } from '@/lib/utils';

const STAGE_LABEL = { outreach: 'Reminder campaign', followup: 'Follow-up campaign' };
const FILTERS = [
  { key: 'all', label: 'All runs' },
  { key: 'outreach', label: 'Reminders' },
  { key: 'followup', label: 'Follow-ups' },
];

const pretty = (k) => String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const stamp = (v) => (v ? new Date(v).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);

const Figure = ({ label, value, tone }) => (
  <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
    <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
    <p className={cn('text-sm font-bold', tone || 'text-zinc-900')}>{value}</p>
  </div>
);

/** What each previous campaign run actually did, read from the stored run records. */
export default function HistoryTab() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = () => {
    setError(false);
    setLoading(true);
    base44.entities.CampaignRun.list('-created_date', 100)
      .then((rows) => setRuns(Array.isArray(rows) ? rows : (rows?.items || [])))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const shown = filter === 'all' ? runs : runs.filter(r => r.stage === filter);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Previous campaign runs</h2>
          <p className="text-xs text-zinc-500">Every reminder and follow-up run, newest first.</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn('px-3 py-1.5 max-sm:min-h-11 text-xs font-semibold', filter === f.key ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState title="Couldn't load campaign history" description="Please try again." onRetry={load} />
      ) : loading ? (
        <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={History}
          title="No campaign runs yet"
          description="Once a reminder or follow-up campaign runs, its result is recorded here."
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => {
            const skipped = Object.entries(r.skip_reasons || {});
            return (
              <li key={r.id} className="rounded-xl border border-zinc-200 bg-white">
                <details>
                  <summary className="cursor-pointer list-none p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-zinc-900">{STAGE_LABEL[r.stage] || r.stage}</p>
                      <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                        r.mode === 'dry_run' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>
                        {r.mode === 'dry_run' ? 'Preview only' : 'Live'}
                      </span>
                      <span className="text-xs text-zinc-500">{r.run_date} · week {r.campaign_week}</span>
                      {r.status === 'failed' && (
                        <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">Failed</span>
                      )}
                      {r.status === 'running' && (
                        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">Running</span>
                      )}
                      <span className="ml-auto text-xs text-zinc-400">{stamp(r.finished_at || r.started_at) || '—'}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Figure label="Eligible" value={r.eligible_total ?? '—'} />
                      <Figure label="Clients" value={r.unique_clients ?? '—'} />
                      <Figure label={r.mode === 'dry_run' ? 'Would be queued' : 'Queued'} value={r.messages_counted ?? '—'} />
                      <Figure label="Excluded" value={r.skipped_count ?? 0} tone={r.skipped_count ? 'text-amber-700' : undefined} />
                    </div>
                  </summary>

                  <div className="border-t border-zinc-100 px-3 py-2.5 space-y-1.5 text-xs text-zinc-600">
                    {r.trigger === 'manual' && <p className="text-[11px] text-zinc-400">Started by {r.actor_name || 'an admin'}.</p>}
                    {r.capped_count > 0 && <p>{r.capped_count} eligible clients were left for the next run because of the {r.max_per_run} limit.</p>}
                    {r.already_processed > 0 && <p>{r.already_processed} clients already had this message this week.</p>}
                    {r.live_blocked_reason && <p>A run meant to be live was recorded as a preview: {r.live_blocked_reason}</p>}
                    {r.error && <p className="font-semibold text-red-700">The run failed: {r.error}</p>}
                    {skipped.length > 0 && (
                      <div>
                        <p className="font-semibold text-zinc-700">Why clients were left out</p>
                        <ul className="mt-1 space-y-0.5">
                          {skipped.map(([k, n]) => <li key={k}>{pretty(k)}: {n}</li>)}
                        </ul>
                      </div>
                    )}
                    {skipped.length === 0 && !r.error && <p>No clients were excluded.</p>}
                    <p className="pt-1 text-[11px] text-zinc-400">
                      Per-client delivery (queued, sent, delivered) is on{' '}
                      <Link to="/admin/reminders?tab=campaigns" className="font-semibold text-indigo-600">Campaigns</Link>.
                    </p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}