import React, { useState } from 'react';
import { Monitor, Smartphone, Eye } from 'lucide-react';
import RegionStep from '@/components/booking/steps/RegionStep';

// Compact Booking Preview — contained module with overflow hidden so it
// shows the top of the actual customer Step 1 without rendering as a full
// second page. Desktop/Mobile toggles render the same responsive component
// at different widths.
export default function BookingPreview({ areas, centre }) {
  const [device, setDevice] = useState('desktop');
  const [customerLocation, setCustomerLocation] = useState(null);
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [priorityStatus, setPriorityStatus] = useState(null);

  const activeAreas = (areas || []).filter(a => a.active !== false);
  const radiusSettings = {
    service_centre_lat: centre?.lat ?? -33.87,
    service_centre_lng: centre?.lng ?? 151.21,
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0e12]">
      {/* Compact header */}
      <div className="px-4 py-2 border-b border-[#1e1e22] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-[#818cf8]" />
          <p className="text-sm font-bold text-white">Booking Preview</p>
          <span className="text-[11px] text-zinc-500 hidden sm:inline">· What customers see in Step 1</span>
        </div>
        <div className="inline-flex rounded-lg bg-[#1a1d24] p-0.5 shrink-0">
          <button
            onClick={() => setDevice('desktop')}
            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md transition-colors ${device === 'desktop' ? 'bg-[#6366f1] text-white' : 'text-zinc-400 hover:text-white'}`}
          >
            <Monitor className="w-3 h-3" /> Desktop
          </button>
          <button
            onClick={() => setDevice('mobile')}
            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md transition-colors ${device === 'mobile' ? 'bg-[#6366f1] text-white' : 'text-zinc-400 hover:text-white'}`}
          >
            <Smartphone className="w-3 h-3" /> Mobile
          </button>
        </div>
      </div>

      {/* Contained preview — overflow hidden clips the full Step 1 */}
      <div className="flex-1 overflow-hidden bg-background">
        <div className={device === 'mobile' ? 'max-w-[400px] mx-auto border-x border-[#2d2e34] h-full overflow-hidden' : 'max-w-3xl mx-auto h-full overflow-hidden'}>
          <div className="px-5 py-3 h-full overflow-hidden">
            <RegionStep
              serviceAreas={activeAreas}
              selectedAreaId={selectedAreaId}
              priorityStatus={priorityStatus}
              onSelectArea={setSelectedAreaId}
              onSelectOutside={() => setPriorityStatus('outside_priority')}
              onContinue={() => {}}
              loading={false}
              loadError={null}
              onRetry={() => {}}
              customerLocation={customerLocation}
              onCustomerLocationChange={setCustomerLocation}
              radiusSettings={radiusSettings}
            />
          </div>
        </div>
      </div>
    </div>
  );
}