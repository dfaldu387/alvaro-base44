import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';

/**
 * In-app warning across the top of the admin area. Dismissible for this visit. Two kinds of item share it:
 * a scheduled job that is overdue, and tomorrow's route having changed (kind 'route'), each saying what stops working.
 */
export default function OverdueJobsBanner({ jobs }) {
  const [dismissed, setDismissed] = useState('');
  const signature = jobs.map((j) => j.key).join(',');
  if (jobs.length === 0 || dismissed === signature) return null;
  const routes = jobs.filter((j) => j.kind === 'route');
  const late = jobs.filter((j) => j.kind !== 'route');
  return (
    <div role="alert" className="flex items-start gap-3 border-b border-red-200 bg-red-50 px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1 text-xs text-red-800 break-words">
        {routes.map((r) => (
          <p key={r.key}>
            <span className="font-bold">{r.name}</span> {r.consequence}{' '}
            <Link to="/admin/schedule" className="font-semibold underline">Open Calendar</Link>
          </p>
        ))}
        {late.length > 0 && (
          <p>
            <span className="font-bold">{late.map((j) => j.name).join(', ')} {late.length > 1 ? 'are' : 'is'} overdue.</span>{' '}
            {late.map((j) => j.consequence).join(' ')}{' '}
            <Link to="/admin/settings/messaging" className="font-semibold underline">Open Messaging &amp; Automation</Link>
          </p>
        )}
      </div>
      <button onClick={() => setDismissed(signature)} aria-label="Dismiss" className="shrink-0 w-6 h-6 flex items-center justify-center text-red-600 hover:text-red-800">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}