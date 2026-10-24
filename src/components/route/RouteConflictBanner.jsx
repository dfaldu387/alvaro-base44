import React from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import { conflictSummary } from '@/lib/scheduleConflicts';

/**
 * The day cannot be served as it stands: two appointments share the same time for the
 * same barber. Stated once, in the one place a barber will look, with the way out
 * (the Calendar). Confirming the day is blocked while this is showing.
 */
export default function RouteConflictBanner({ conflicts = [], className = '' }) {
  if (!conflicts.length) return null;
  return (
    <div className={`mx-4 mb-3 rounded-2xl border border-red-500/40 bg-red-500/[0.07] px-4 py-3 ${className}`}>
      <div className="flex items-start gap-2.5">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-red-600">
            {conflicts.length === 1 ? 'Two appointments overlap' : `${conflicts.length} appointments overlap`}
          </p>
          {conflicts.slice(0, 3).map((c) => (
            <p key={`${c.a.id}_${c.b.id}`} className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {conflictSummary(c)}
            </p>
          ))}
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            One of them has to move before this day can be confirmed.
          </p>
        </div>
        <Link
          to="/admin/schedule"
          className="shrink-0 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-600"
        >
          Fix on Calendar
        </Link>
      </div>
    </div>
  );
}