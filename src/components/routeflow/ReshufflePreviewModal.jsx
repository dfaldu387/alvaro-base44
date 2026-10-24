/**
 * ReshufflePreviewModal — before/after preview of a Route Flow reshuffle
 * suggestion. Nothing is written to the calendar until Apply Changes.
 */
import React, { useState } from 'react';
import { X, ArrowRight, Lock, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';

const REASON_LABELS = {
  locked: 'Locked',
  confirmed: 'Confirmed',
  override: 'Override',
  protected: 'Protected',
  block: 'Block',
};

function formatMins(mins) {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export default function ReshufflePreviewModal({ suggestion, onClose, onApplied }) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  const cur = suggestion.current || {};
  const pro = suggestion.proposed || {};
  const imp = suggestion.improvement || {};
  const changes = suggestion.changes || [];

  const rows = [
    { label: 'Appointments', cur: `${cur.scheduled_count ?? 0}`, pro: `${pro.scheduled_count ?? 0}` },
    { label: 'Driving', cur: formatMins(cur.total_drive_minutes), pro: formatMins(pro.total_drive_minutes) },
    { label: 'Idle', cur: formatMins(cur.total_idle_minutes), pro: formatMins(pro.total_idle_minutes) },
  ];

  const improvements = [];
  if (imp.drive_minutes_saved > 0) improvements.push(`${imp.drive_minutes_saved}m less driving`);
  if (imp.idle_minutes_saved > 0) improvements.push(`${imp.idle_minutes_saved}m less idle`);
  if (imp.additional_bookings_fit > 0) improvements.push(`${imp.additional_bookings_fit} extra booking${imp.additional_bookings_fit === 1 ? '' : 's'}`);

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('routeFlowApplyReshuffleV2', { suggestion_id: suggestion.id });
      if (res.data?.error) throw new Error(res.data.error);
      onApplied?.(suggestion, res.data);
    } catch {
      setError('Could not apply the changes. Please try again.');
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-zinc-900">Better schedule available</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {suggestion.day_of_week}
              {suggestion.team_member_name ? ` · ${suggestion.team_member_name}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200 shrink-0">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Before / after metrics */}
          <div className="rounded-xl border border-zinc-200 overflow-hidden">
            <div className="grid grid-cols-3 bg-zinc-50 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <div className="px-3 py-2" />
              <div className="px-3 py-2 text-center border-l border-zinc-100">Current</div>
              <div className="px-3 py-2 text-center border-l border-zinc-100 text-[#6366F1]">Suggested</div>
            </div>
            {rows.map(r => (
              <div key={r.label} className="grid grid-cols-3 border-t border-zinc-100">
                <div className="px-3 py-2.5 text-xs font-semibold text-zinc-600">{r.label}</div>
                <div className="px-3 py-2.5 text-center text-sm text-zinc-700 border-l border-zinc-100">{r.cur}</div>
                <div className="px-3 py-2.5 text-center text-sm font-bold text-[#6366F1] border-l border-zinc-100 bg-[#6366F1]/[0.03]">{r.pro}</div>
              </div>
            ))}
          </div>

          {improvements.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {improvements.map(i => (
                <span key={i} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {i}
                </span>
              ))}
            </div>
          )}

          {/* Per-appointment changes */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Changes</p>
            <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100">
              {changes.map(c => (
                <div key={c.booking_request_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-800 truncate">{c.client_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-zinc-500">{c.from_label}</span>
                      <ArrowRight className="w-3 h-3 text-zinc-400 shrink-0" />
                      <span className={cn('text-xs', c.moving ? 'font-bold text-[#6366F1]' : 'text-zinc-400')}>
                        {c.moving ? c.to_label : 'unchanged'}
                      </span>
                    </div>
                  </div>
                  {c.protected ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full shrink-0">
                      <Lock className="w-3 h-3" /> {REASON_LABELS[c.anchor_reason] || 'Protected'}
                    </span>
                  ) : c.moving ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[#6366F1] bg-[#6366F1]/10 px-2 py-1 rounded-full shrink-0">
                      {c.is_new ? 'New' : 'Moving'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 bg-zinc-100 px-2 py-1 rounded-full shrink-0">
                      Unchanged
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400 mt-2">
              Locked and Confirmed appointments are never moved. Nothing changes until you apply.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-100 shrink-0">
          <button
            onClick={onClose}
            disabled={applying}
            className="text-sm font-semibold text-zinc-600 hover:text-zinc-900 px-4 py-2.5 rounded-xl hover:bg-zinc-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-2 text-sm font-bold text-white bg-[#6366F1] hover:bg-[#6366F1]/90 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {applying && <Loader2 className="w-4 h-4 animate-spin" />}
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}