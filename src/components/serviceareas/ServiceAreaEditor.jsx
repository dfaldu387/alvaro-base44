import React, { useState } from 'react';
import { Save, Trash2, Map as MapIcon, RotateCcw } from 'lucide-react';
import SectionCard from './SectionCard';
import ZoneDetailsSection from './ZoneDetailsSection';
import ZoneCentreSection from './ZoneCentreSection';
import PriorityDaysSection from './PriorityDaysSection';

// Dark-themed right column editor. The centre map is the live preview.
export default function ServiceAreaEditor({ draft, onChange, teamMembers, canEdit, onSave, onDiscard, onDelete, saving, isDirty, onGeocoded }) {
  const [savedFlash, setSavedFlash] = useState(false);

  if (!draft) {
    return (
      <div className="h-full flex items-center justify-center text-center p-8 bg-[#111114]">
        <div>
          <div className="w-12 h-12 rounded-full bg-[#1a1a1e] mx-auto flex items-center justify-center mb-3">
            <MapIcon className="w-6 h-6 text-zinc-600" />
          </div>
          <p className="text-sm font-medium text-zinc-400">Select a service zone</p>
          <p className="text-xs text-zinc-600 mt-1">Choose a zone from the list or add a new one.</p>
        </div>
      </div>
    );
  }

  const isUnsavedNew = !draft.id || String(draft.id).startsWith('new-');
  const set = (k, v) => onChange({ ...draft, [k]: v });
  const assignedMember = teamMembers.find((t) => t.id === draft.team_member_id) || null;

  const handleSave = () => {
    const payload = { ...draft, team_member_name: assignedMember ? assignedMember.name : '' };
    onSave(payload);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  return (
    <div className="flex flex-col h-full bg-[#111114]">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-[#1e1e22] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[#818cf8] uppercase tracking-wider">{isUnsavedNew ? 'New zone' : 'Edit Zone'}</p>
          <h2 className="text-base font-bold text-white truncate">{draft.name || 'Untitled zone'}</h2>
        </div>
        {onDelete && canEdit && !isUnsavedNew && (
          <button
            onClick={() => onDelete(draft)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
            title="Delete zone"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {!canEdit && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-400">
            You can view this zone but only admins or the assigned barber can edit it.
          </div>
        )}

        <ZoneDetailsSection draft={draft} set={set} teamMembers={teamMembers} canEdit={canEdit} />
        <ZoneCentreSection draft={draft} set={set} onChange={onChange} canEdit={canEdit} onGeocoded={onGeocoded} />

        <SectionCard title="Description" description="Optional text shown to customers on the homepage.">
          <textarea
            value={draft.description || ''}
            onChange={(e) => set('description', e.target.value)}
            disabled={!canEdit}
            placeholder="Add a note about this zone..."
            rows={2}
            className="w-full rounded-lg border border-[#27272a] bg-[#222226] px-3 py-2 text-sm text-white outline-none focus:border-[#6366f1] disabled:opacity-50 resize-none placeholder:text-zinc-600"
          />
        </SectionCard>

        <PriorityDaysSection draft={draft} set={set} canEdit={canEdit} />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#1e1e22] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isDirty && canEdit && (
            <button
              onClick={onDiscard}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272a] bg-[#1a1a1e] px-3.5 py-2 text-sm font-semibold text-zinc-400 hover:bg-[#222226] disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
          {!isDirty && <p className="text-xs text-zinc-600">No unsaved changes.</p>}
        </div>
        <button
          onClick={handleSave}
          disabled={!canEdit || saving}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${savedFlash ? 'bg-emerald-600 text-white' : 'bg-[#6366f1] text-white hover:bg-[#5558eb]'}`}
        >
          <Save className="w-3.5 h-3.5" />
          {savedFlash ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}