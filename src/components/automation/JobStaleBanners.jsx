import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ago, jobView } from '@/lib/automation';

const CHECKS = [
  { key: 'arrival', name: 'Arrival Times', limit: 'over 90 minutes', consequence: 'Arrival-time messages will not be queued.' },
  { key: 'campaign', name: 'Campaign Run', limit: 'over 25 hours', consequence: 'Reminder campaigns will not run.' },
];

/** The sweep has its own banner; this gives the other two scheduled jobs the same warning. */
export default function JobStaleBanners({ data }) {
  const warnings = CHECKS.map((c) => ({ c, v: jobView(c.key, data) })).filter(({ v }) => v.overdue);
  return warnings.map(({ c, v }) => (
    <div key={c.key} role="alert" className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4">
      <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-red-800">{c.name} may not be running</p>
        <p className="text-xs text-red-700 mt-1">
          {v.neverRun ? `${c.name} has never recorded a run.` : `${c.name} last ran ${ago(v.lastRunAt)} (${c.limit} ago).`} {c.consequence}
        </p>
      </div>
    </div>
  ));
}