import React from 'react';
import { Trash2, Map as MapIcon } from 'lucide-react';
import LocationAutocomplete from '@/components/serviceareas/LocationAutocomplete';
import { WEEK_DAYS, DAY_SHORT } from '@/lib/serviceAreaUtils';

const PRESET_COLOURS = ['#8B5CF6', '#3B82F6', '#10B981', '#F97316', '#EF4444', '#EC4899'];

function FieldGroup({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-1 w-1 rounded-full bg-indigo-600" />
        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">{title}</p>
      </div>
      {children}
    </div>
  );
}

// Right column — Edit Zone panel grouped into clear sections:
// Zone Details, Assignment, Priority Days, Status.
export default function CoverageZoneEditor({ draft, onChange, teamMembers, canEdit, onDelete, onGeocoded }) {
  if (!draft) {
    return (
      <div className="h-full flex items-center justify-center text-center p-6 bg-white">
        <div>
          <MapIcon className="w-7 h-7 text-zinc-300 mx-auto mb-2" />
          <p className="text-xs text-zinc-500">Select a zone to edit</p>
        </div>
      </div>
    );
  }

  const isUnsavedNew = !draft.id || String(draft.id).startsWith('new-');
  const set = (k, v) => onChange({ ...draft, [k]: v });

  const handleLocationSelect = (place) => {
    const next = { ...draft, centre_suburb: place.formatted_address, latitude: place.lat, longitude: place.lng };
    if (place.postcode && !(draft.postcodes || []).includes(place.postcode)) {
      next.postcodes = [...(draft.postcodes || []), place.postcode];
    }
    if (place.suburb && !(draft.suburbs || []).includes(place.suburb)) {
      next.suburbs = [...(draft.suburbs || []), place.suburb];
    }
    onChange(next);
    onGeocoded?.();
  };

  const toggleDay = (dayName) => {
    if (!canEdit) return;
    const days = draft.service_days || [];
    const existing = days.find(d => d.day_of_week === dayName);
    if (existing) {
      set('service_days', days.map(d => d.day_of_week === dayName ? { ...d, enabled: !d.enabled } : d));
    } else {
      set('service_days', [...days, { day_of_week: dayName, enabled: true }]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-zinc-900">{isUnsavedNew ? 'New Zone' : 'Edit Zone'}</h2>
        {onDelete && canEdit && !isUnsavedNew && (
          <button
            onClick={() => onDelete(draft)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Zone Details */}
        <FieldGroup title="Zone Details">
          <div>
            <label className="text-xs font-medium text-zinc-600 mb-1.5 block">Zone Name</label>
            <input
              value={draft.name || ''}
              onChange={(e) => set('name', e.target.value)}
              disabled={!canEdit}
              placeholder="e.g. St George"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 mb-1.5 block">Zone Colour</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLOURS.map(c => (
                <button
                  key={c}
                  onClick={() => canEdit && set('colour', c)}
                  className={`w-7 h-7 rounded-full transition-all ${draft.colour === c ? 'ring-2 ring-zinc-900 ring-offset-2 ring-offset-white' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={draft.colour || '#8B5CF6'}
                onChange={(e) => set('colour', e.target.value)}
                disabled={!canEdit}
                className="w-7 h-7 rounded cursor-pointer bg-transparent border border-zinc-200 disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 mb-1.5 block">Centre Location</label>
            <LocationAutocomplete
              theme="light"
              value={draft.centre_suburb || ''}
              onSelect={handleLocationSelect}
              disabled={!canEdit}
              placeholder="Search suburb or address..."
            />
            {draft.latitude != null && draft.longitude != null && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">Latitude</label>
                  <input type="text" readOnly value={draft.latitude.toFixed(4)} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 bg-zinc-50 outline-none" />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">Longitude</label>
                  <input type="text" readOnly value={draft.longitude.toFixed(4)} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 bg-zinc-50 outline-none" />
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 mb-1.5 block">Radius (km)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={draft.radius_km ?? 10}
                min={1}
                max={200}
                onChange={(e) => set('radius_km', Math.max(1, Number(e.target.value) || 1))}
                disabled={!canEdit}
                className="w-20 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 text-center outline-none focus:border-indigo-600 disabled:opacity-50"
              />
              <span className="text-sm text-zinc-500">km</span>
            </div>
          </div>
        </FieldGroup>

        {/* Assignment */}
        <FieldGroup title="Assignment">
          <div>
            <label className="text-xs font-medium text-zinc-600 mb-1.5 block">Assigned Barber</label>
            <select
              value={draft.team_member_id || ''}
              onChange={(e) => set('team_member_id', e.target.value || null)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-600 disabled:opacity-50"
            >
              <option value="">Select barber</option>
              {teamMembers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </FieldGroup>

        {/* Priority Days */}
        <FieldGroup title="Priority Days">
          <div className="flex gap-1.5 flex-wrap">
            {WEEK_DAYS.map(day => {
              const d = (draft.service_days || []).find(x => x.day_of_week === day);
              const enabled = !!(d && d.enabled);
              return (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`w-11 h-11 sm:w-9 sm:h-9 rounded-full text-xs font-semibold transition-all ${enabled ? 'bg-indigo-600 text-zinc-900' : 'bg-white text-zinc-500 border border-zinc-200 hover:bg-zinc-50'}`}
                >
                  {DAY_SHORT[day]}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-600">Determines when this area is prioritised. Does not control bookable hours.</p>
        </FieldGroup>

        {/* Status */}
        <FieldGroup title="Status">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">Active Zone</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Show on map and allow bookings.</p>
            </div>
            <button
              onClick={() => canEdit && set('active', draft.active === false ? true : false)}
              disabled={!canEdit}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${draft.active !== false ? 'bg-indigo-600' : 'bg-zinc-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${draft.active !== false ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </FieldGroup>
      </div>
    </div>
  );
}