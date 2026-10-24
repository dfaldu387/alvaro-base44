import React from 'react';
import SectionCard from './SectionCard';
import StatusToggle from './StatusToggle';
import ColourSelector from './ColourSelector';

// Dark-themed zone details: name, assigned barber, status, colour.
export default function ZoneDetailsSection({ draft, set, teamMembers, canEdit }) {
  return (
    <SectionCard title="Zone details" description="Name and barber for this service zone.">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Zone name</label>
          <input
            value={draft.name || ''}
            onChange={(e) => set('name', e.target.value)}
            disabled={!canEdit}
            placeholder="e.g. St George"
            className="w-full rounded-lg border border-[#27272a] bg-[#222226] px-3 py-2 text-sm text-white outline-none focus:border-[#6366f1] disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Assigned barber</label>
          <select
            value={draft.team_member_id || ''}
            onChange={(e) => set('team_member_id', e.target.value || null)}
            disabled={!canEdit}
            className="w-full rounded-lg border border-[#27272a] bg-[#222226] px-3 py-2 text-sm text-white outline-none focus:border-[#6366f1] disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {teamMembers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-400 mb-2 block">Zone colour</label>
        <ColourSelector value={draft.colour} onChange={(v) => set('colour', v)} disabled={!canEdit} />
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-400 mb-2 block">Status</label>
        <StatusToggle active={draft.active !== false} onChange={(v) => set('active', v)} disabled={!canEdit} />
      </div>
    </SectionCard>
  );
}