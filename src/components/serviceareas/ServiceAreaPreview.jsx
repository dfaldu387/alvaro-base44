import React from 'react';
import { MapPin, Clock, Tag } from 'lucide-react';
import { DAY_SHORT, formatUsuallyServiced } from '@/lib/serviceAreaUtils';

// Full modal mock of how the zone appears to customers in the booking flow.
// Reads from the live draft state — no changes are saved by opening this.
export function PreviewModal({ area, onClose }) {
  const days = (area.service_days || []).filter(d => d.enabled).map(d => d.day_of_week);
  const suburbs = area.suburbs || [];
  const postcodes = area.postcodes || [];
  const colour = area.colour || '#6f22cf';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
          <p className="text-sm font-bold text-zinc-900">Preview booking view</p>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-sm">Close</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Customer-facing zone card */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="w-3 h-3 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: colour }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-bold text-zinc-900">{area.name || 'Untitled zone'}</p>
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: colour }}>
                    <Tag className="w-2.5 h-2.5" /> Priority Zone
                  </span>
                </div>
                <p className="text-sm text-zinc-500 mt-1.5">{formatUsuallyServiced(days)}</p>
                {area.centre_suburb && (
                  <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {area.centre_suburb}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-zinc-100">
              {days.length ? days.map(d => (
                <span
                  key={d}
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: `${colour}12`, color: colour, border: `1px solid ${colour}33` }}
                >
                  {DAY_SHORT[d]}
                </span>
              )) : <span className="text-xs text-zinc-400">No service days</span>}
            </div>
          </div>

          {(suburbs.length > 0 || postcodes.length > 0) && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Areas covered</p>
              <div className="flex flex-wrap gap-1.5">
                {[...suburbs, ...postcodes].map((s, i) => (
                  <span key={i} className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{s}</span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-start gap-2 text-xs text-zinc-500">
              <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Customers select a day and drag to set their availability within your working hours.</span>
            </div>
          </div>

          <p className="text-[11px] text-zinc-400 text-center">This is a preview only — no changes are saved.</p>
        </div>
      </div>
    </div>
  );
}