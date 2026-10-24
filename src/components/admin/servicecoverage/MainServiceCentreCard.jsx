import React, { useState } from 'react';
import { Crosshair, ChevronDown } from 'lucide-react';
import LocationAutocomplete from '@/components/serviceareas/LocationAutocomplete';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function RadiusField({ label, value, onChange }) {
  return (
    <div className="w-full sm:w-32 sm:shrink-0">
      <label className="text-xs font-medium text-zinc-500 mb-1 block">{label}</label>
      <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 h-11 sm:h-10">
        <input
          type="number"
          value={value}
          min={1}
          onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
          className="w-full bg-transparent text-sm text-zinc-900 outline-none"
        />
        <span className="text-xs text-zinc-500 shrink-0">km</span>
      </div>
    </div>
  );
}

// Coverage Centre, Extended Radius, Maximum Radius and Save on one row (stacked on phones).
export default function MainServiceCentreCard({
  centre, onCentreChange, onSetCurrentLocation,
  extendedRadius, onExtendedRadiusChange,
  maxRadius, onMaxRadiusChange,
  onSave, saving, savedFlash,
}) {
  const [showCoords, setShowCoords] = useState(false);

  const handleSelect = (place) => {
    onCentreChange({ lat: place.lat, lng: place.lng, address: place.formatted_address || '' });
  };
  const iconBtn = 'h-11 w-11 sm:h-10 sm:w-10 rounded-lg border border-zinc-200 bg-white flex items-center justify-center text-zinc-500 hover:bg-zinc-50 shrink-0';

  return (
    <div>
      <div className="flex items-end gap-3 flex-wrap">
        <div className="w-full sm:flex-1 sm:min-w-[220px]">
          <label className="text-xs font-medium text-zinc-500 mb-1 block">Coverage Centre</label>
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <LocationAutocomplete theme="light" value={centre.address || ''} onSelect={handleSelect} placeholder="Search suburb or address..." />
            </div>
            <button onClick={onSetCurrentLocation} title="Set to current location" className={iconBtn}>
              <Crosshair className="w-4 h-4" />
            </button>
            <button onClick={() => setShowCoords(!showCoords)} title="Show coordinates" className={iconBtn}>
              <ChevronDown className={`w-4 h-4 transition-transform ${showCoords ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 w-full sm:contents">
          <RadiusField label="Extended Radius" value={extendedRadius} onChange={onExtendedRadiusChange} />
          <RadiusField label="Maximum Radius" value={maxRadius} onChange={onMaxRadiusChange} />
        </div>

        <div className="w-full sm:w-auto">
          <Button
            onClick={onSave}
            disabled={saving}
            className={`w-full sm:w-auto h-11 sm:h-10 font-semibold ${savedFlash ? 'bg-emerald-600 hover:bg-emerald-600' : ''}`}
          >
            {savedFlash ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {showCoords && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Latitude</label>
            <Input readOnly value={centre.lat != null ? centre.lat.toFixed(4) : '—'} className="bg-zinc-50" />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Longitude</label>
            <Input readOnly value={centre.lng != null ? centre.lng.toFixed(4) : '—'} className="bg-zinc-50" />
          </div>
        </div>
      )}
    </div>
  );
}