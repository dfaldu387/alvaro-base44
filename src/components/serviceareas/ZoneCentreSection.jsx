import React from 'react';
import { MapPin } from 'lucide-react';
import SectionCard from './SectionCard';
import LocationAutocomplete from './LocationAutocomplete';

// Dark-themed location section. Mapbox autocomplete for location search —
// no "Find location" button. Map updates live. Service radius is configured
// globally in Booking Rules, not per zone.
export default function ZoneCentreSection({ draft, set, onChange, canEdit, onGeocoded }) {
  const handleLocationSelect = (place) => {
    const next = {
      ...draft,
      centre_suburb: place.formatted_address,
      latitude: place.lat,
      longitude: place.lng,
    };
    if (place.postcode && !(draft.postcodes || []).includes(place.postcode)) {
      next.postcodes = [...(draft.postcodes || []), place.postcode];
    }
    if (place.suburb && !(draft.suburbs || []).includes(place.suburb)) {
      next.suburbs = [...(draft.suburbs || []), place.suburb];
    }
    onChange(next);
    onGeocoded?.();
  };

  return (
    <SectionCard title="Location" description="Search a suburb or address for this zone's centre. Service radius is set globally in Booking Rules.">
      <div>
        <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Location</label>
        <LocationAutocomplete
          value={draft.centre_suburb || ''}
          onSelect={handleLocationSelect}
          disabled={!canEdit}
        />
        {draft.latitude != null && draft.longitude != null && (
          <p className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-emerald-400" />
            {draft.latitude.toFixed(4)}, {draft.longitude.toFixed(4)}
          </p>
        )}
      </div>
    </SectionCard>
  );
}