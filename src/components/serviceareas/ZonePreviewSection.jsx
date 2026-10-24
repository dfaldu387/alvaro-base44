import React from 'react';
import { MapPin, Clock, Tag } from 'lucide-react';
import { DAY_SHORT } from '@/lib/serviceAreaUtils';
import SectionCard from './SectionCard';

// Section 4 — Public preview: a live customer-facing zone card that updates
// as the admin edits the draft. Uses the actual configured zone colour.
export default function ZonePreviewSection({ draft }) {
  const days = (draft.service_days || []).filter(d => d.enabled).map(d => d.day_of_week);
  const colour = draft.colour || '#6f22cf';

  return (
    <SectionCard title="Public preview" description="How customers see this zone on your homepage.">
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <span
            className="w-3 h-3 rounded-full shrink-0 mt-1.5"
            style={{ backgroundColor: colour }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-zinc-900">{draft.name || 'Untitled zone'}</p>
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: colour }}>
                <Tag className="w-2.5 h-2.5" /> Priority Zone
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">Priority days: {days.length ? days.map(d => DAY_SHORT[d]).join(', ') : 'None set'}</p>
            {draft.centre_suburb && (
              <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {draft.centre_suburb}
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
          )) : (
            <span className="text-xs text-zinc-400">No service days configured</span>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-zinc-50 border border-zinc-100 px-3 py-2.5">
        <Clock className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-500 leading-relaxed">
          These priority days determine when this area is shown to customers. Bookable hours are managed separately in Bookable Hours settings.
        </p>
      </div>
    </SectionCard>
  );
}