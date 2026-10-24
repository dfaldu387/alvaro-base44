/**
 * StartLocationCard — "Default Start Location" on a team member's profile.
 *
 * The barber profile is the single source of truth for where their day starts.
 * Route Flow reads start_location_address / start_location_lat /
 * start_location_lng from the assigned barber to measure real road travel to the
 * first appointment of the day — never a business-wide address.
 *
 * Editing the address text drops the saved coordinates, so a stale pair can
 * never be kept alongside a new address.
 */
import React from 'react';
import { MapPin, Loader2, Check, AlertTriangle } from 'lucide-react';
import AdminCard from '@/components/admin/ui/AdminCard';
import { cn } from '@/lib/utils';
import LocationAutocomplete from '@/components/serviceareas/LocationAutocomplete';

export default function StartLocationCard({ address, lat, lng, barberName, onChange, onSave, saving }) {
  const hasCoords = typeof lat === 'number' && isFinite(lat) && typeof lng === 'number' && isFinite(lng);
  const configured = hasCoords;
  const textWithoutCoords = !!address && !hasCoords;

  const handleSelect = (place) => onChange({
    start_location_address: place.formatted_address,
    start_location_lat: place.lat,
    start_location_lng: place.lng,
  });

  const handleClear = () => onChange({
    start_location_address: '',
    start_location_lat: null,
    start_location_lng: null,
  });

  return (
    <AdminCard className="p-0 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3.5 border-b border-zinc-100">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#5E42F3]/10 flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4 text-[#5E42F3]" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Default Start Location</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Where {barberName || 'this barber'} starts the day. Route Flow measures real road travel from here to the first appointment.
            </p>
          </div>
        </div>
        <span className={cn('text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap',
          configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </div>

      <div className="px-4 py-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-zinc-700">Start address</p>
          <div className="mt-1.5">
            <LocationAutocomplete
              theme="light"
              value={address}
              placeholder="Search the address this barber starts from"
              onSelect={handleSelect}
              onInvalidate={() => onChange({ start_location_lat: null, start_location_lng: null })}
              onClear={handleClear}
            />
          </div>
        </div>

        {/* Selected address preview */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2.5 flex items-start gap-2.5">
          <MapPin className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900">{address || 'No start location saved'}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {hasCoords ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Coordinates not saved'}
            </p>
          </div>
        </div>

        {!configured && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              {textWithoutCoords
                ? 'Select the address from the suggestions to save its coordinates. Edited text never keeps the old coordinates.'
                : 'Start location not configured — first-leg travel cannot be verified. Route Flow will not auto-place the first appointment of this barber\u2019s day until a start location is saved.'}
            </p>
          </div>
        )}

        <div className="flex items-end justify-between gap-3 pt-1">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Used for the first appointment of the day. Later appointments are measured from the previous appointment.
          </p>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 bg-[#5E42F3] hover:bg-[#4F35E0] text-white text-sm font-semibold px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Check className="w-3.5 h-3.5" /> Save location</>}
          </button>
        </div>
      </div>
    </AdminCard>
  );
}