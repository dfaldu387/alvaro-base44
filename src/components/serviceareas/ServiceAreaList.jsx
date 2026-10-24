import React from 'react';
import { Search, MapPin } from 'lucide-react';

// Dark-themed zone list for the left column. Compact cards with colour dot,
// name, location/radius, and active/inactive badge. No add button — that's
// in the page header.
export default function ServiceAreaList({ areas, selectedId, onSelect, search, onSearch }) {
  return (
    <div className="flex flex-col h-full bg-[#111114]">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[#1e1e22]">
        <p className="text-sm font-bold text-white">Zones ({areas.length})</p>
      </div>

      {/* Search */}
      <div className="p-2.5 border-b border-[#1e1e22]">
        <div className="flex items-center gap-2 rounded-lg border border-[#27272a] bg-[#1a1a1e] px-2.5 py-2 focus-within:border-[#6366f1]">
          <Search className="w-3.5 h-3.5 text-zinc-600" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search zones"
            className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {areas.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-10 h-10 rounded-full bg-[#1a1a1e] mx-auto flex items-center justify-center mb-2.5">
              <MapPin className="w-5 h-5 text-zinc-600" />
            </div>
            <p className="text-xs font-medium text-zinc-400">No service zones</p>
            <p className="text-[11px] text-zinc-600 mt-0.5">Add your first zone.</p>
          </div>
        ) : (
          areas.map((a) => {
            const selected = a.id === selectedId;
            const colour = a.colour || '#7c3aed';
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className={`w-full text-left rounded-lg border p-2.5 transition-all ${selected ? 'border-[#6366f1] bg-[#6366f1]/8' : 'border-[#27272a] bg-[#1a1a1e] hover:border-[#3a3a3e] hover:bg-[#1e1e22]'}`}
              >
                <div className="flex items-start gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: colour }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white truncate">{a.name || 'Untitled zone'}</p>
                      <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${a.active !== false ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${a.active !== false ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                        {a.active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                      {a.centre_suburb || 'No location set'}
                    </p>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}