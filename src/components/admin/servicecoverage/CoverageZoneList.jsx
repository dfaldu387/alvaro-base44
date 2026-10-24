import React from 'react';
import { Plus, MapPin } from 'lucide-react';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import { Button } from '@/components/ui/button';

// Left column: compact zone cards. Selected zone gets a coloured border accent.
export default function CoverageZoneList({ areas, selectedId, onSelect, onAdd, canAdd }) {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-3 py-2.5 border-b border-zinc-200 flex items-center justify-between">
        <p className="text-sm font-bold text-zinc-900">Service Zones</p>
        {canAdd && (
          <Button size="sm" onClick={onAdd} className="min-h-[44px] sm:min-h-0 gap-1">
            <Plus className="w-3.5 h-3.5" /> Add Zone
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {areas.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-10 h-10 rounded-full bg-zinc-100 mx-auto flex items-center justify-center mb-2.5">
              <MapPin className="w-5 h-5 text-zinc-400" />
            </div>
            <p className="text-xs font-medium text-zinc-600">No service zones</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Add your first zone.</p>
          </div>
        ) : (
          areas.map((a) => {
            const selected = a.id === selectedId;
            const colour = a.colour || '#8B5CF6';
            const radius = a.radius_km || 10;
            const inactive = a.active === false;
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className={`w-full text-left rounded-lg border p-3 min-h-[56px] transition-all ${selected ? 'bg-zinc-50' : 'bg-white border-zinc-200 hover:bg-zinc-50'}`}
                style={selected ? { borderColor: colour, boxShadow: `0 0 0 1px ${colour}40` } : {}}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colour }} />
                  <p className="text-sm font-semibold text-zinc-900 truncate flex-1">{a.name || 'Untitled zone'}</p>
                  <StatusBadge tone={inactive ? 'neutral' : 'success'}>{inactive ? 'Inactive' : 'Active'}</StatusBadge>
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5 ml-[18px] truncate">
                  {a.centre_suburb || 'No location'} · {radius} km
                </p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}