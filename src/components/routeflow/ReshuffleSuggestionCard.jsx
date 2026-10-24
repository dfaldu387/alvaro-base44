/**
 * ReshuffleSuggestionCard — compact card shown in Route Flow → Review & Control.
 * Displays a pending reshuffle suggestion and offers Review / Dismiss.
 */
import React from 'react';
import { format, addDays, startOfWeek } from 'date-fns';
import { fromDateKey } from '@/lib/dateScope';
import { Eye } from 'lucide-react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayDate(dayName) {
  const idx = DAYS.indexOf(dayName);
  if (idx < 0) return null;
  return addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), idx);
}

export default function ReshuffleSuggestionCard({ suggestion, onReview, onDismiss, busy }) {
  const imp = suggestion.improvement || {};
  // The suggestion's own date is authoritative; the weekday is display only
  const date = suggestion.suggestion_date ? fromDateKey(suggestion.suggestion_date) : dayDate(suggestion.day_of_week);
  const moved = suggestion.provisional_moved_count || 0;

  const bullets = [];
  if (moved > 0) bullets.push(`${moved} provisional appointment${moved === 1 ? '' : 's'} adjusted`);
  bullets.push(`${suggestion.protected_count || 0} protected appointment${(suggestion.protected_count || 0) === 1 ? '' : 's'} moved`);
  if (imp.drive_minutes_saved > 0) bullets.push(`${imp.drive_minutes_saved} min driving saved`);
  if (imp.idle_minutes_saved > 0) bullets.push(`${imp.idle_minutes_saved} min idle time reduced`);
  if (imp.additional_bookings_fit > 0) bullets.push(`${imp.additional_bookings_fit} extra booking${imp.additional_bookings_fit === 1 ? '' : 's'} fits`);

  return (
    <div className="rounded-xl border border-[#6366F1]/30 bg-[#6366F1]/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-[#6366F1] uppercase tracking-wider">Route Flow Suggestion</p>
          <p className="text-sm font-bold text-zinc-900 mt-1">
            {suggestion.day_of_week}
            {date ? ` · ${format(date, 'd MMMM')}` : ''}
            {suggestion.team_member_name ? ` · ${suggestion.team_member_name}` : ''}
          </p>
          <ul className="mt-2 space-y-0.5">
            {bullets.map((b, i) => (
              <li
                key={i}
                className={b.includes('saved') || b.includes('reduced') || b.includes('fits') ? 'text-xs font-medium text-emerald-600' : 'text-xs text-zinc-600'}
              >
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onDismiss(suggestion)}
            disabled={busy}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-700 px-2.5 py-1.5 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={() => onReview(suggestion)}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#6366F1] hover:bg-[#6366F1]/90 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <Eye className="w-3.5 h-3.5" /> Review
          </button>
        </div>
      </div>
    </div>
  );
}