import React from 'react';
import { MapPin, X, CheckCircle, Circle, AlertTriangle } from 'lucide-react';
import { MapContainer, TileLayer, Polygon, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Core Service Area polygon (Hurstville, Kingsgrove, Bexley, Kogarah, Carlton, Rockdale, Mortdale, Penshurst, Allawah, Beverly Hills, Oatley)
const CORE_POLYGON = [
  [-33.9450, 151.0800], // Beverly Hills (NW)
  [-33.9300, 151.1000], // Kingsgrove (N)
  [-33.9200, 151.1100], // Earlwood border NE
  [-33.9350, 151.1350], // Bexley
  [-33.9500, 151.1400], // Carlton
  [-33.9620, 151.1350], // Rockdale
  [-33.9700, 151.1300], // Kogarah
  [-33.9720, 151.1200], // Allawah
  [-33.9850, 151.1100], // Oatley
  [-33.9900, 151.0950], // Mortdale
  [-33.9800, 151.0800], // Penshurst
  [-33.9650, 151.0750], // Hurstville SW
  [-33.9500, 151.0750], // Beverly Hills S
];

// Extended Service Area polygon (expanded outer ring)
const EXTENDED_POLYGON = [
  [-33.8700, 151.0500], // Marrickville far NW
  [-33.8600, 151.0850], // Newtown / Marrickville N
  [-33.8750, 151.1500], // Mascot NE
  [-33.9100, 151.1750], // Brighton-Le-Sands E
  [-33.9500, 151.1800], // Ramsgate / Sans Souci SE
  [-33.9900, 151.1600], // Dolls Point S
  [-34.0250, 151.1100], // Revesby S
  [-34.0200, 151.0600], // Bankstown SW
  [-33.9900, 151.0250], // Padstow W
  [-33.9600, 151.0150], // Bankstown NW
  [-33.9200, 151.0200], // Earlwood W
  [-33.8900, 151.0350], // Marrickville SW
];

const CORE_SUBURBS = ['Hurstville', 'Kingsgrove', 'Bexley', 'Kogarah', 'Carlton', 'Rockdale', 'Mortdale', 'Penshurst', 'Allawah', 'Beverly Hills', 'Oatley'];
const EXTENDED_SUBURBS = ['Marrickville', 'Earlwood', 'Mascot', 'Brighton-Le-Sands', 'Bankstown', 'Padstow', 'Revesby', 'Ramsgate', 'Sans Souci', 'Dolls Point', 'Newtown'];

export default function ServiceAreaModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-card border border-border rounded-t-3xl sm:rounded-2xl overflow-hidden max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-foreground text-base">Service Area</h2>
              <p className="text-xs text-muted-foreground">Sydney South & Inner West</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">
          {/* Map */}
          <div className="h-64 w-full">
            <MapContainer
              center={[-33.955, 151.100]}
              zoom={12}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
              attributionControl={false}
              scrollWheelZoom={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              {/* Extended zone — render first so core sits on top */}
              <Polygon
                positions={EXTENDED_POLYGON}
                pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.25, weight: 2 }}
              >
                <Tooltip sticky>Extended Service Area</Tooltip>
              </Polygon>
              {/* Core zone */}
              <Polygon
                positions={CORE_POLYGON}
                pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.35, weight: 2 }}
              >
                <Tooltip sticky>Core Service Area</Tooltip>
              </Polygon>
            </MapContainer>
          </div>

          {/* Legend + suburbs */}
          <div className="p-5 space-y-4">

            {/* Core */}
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="font-semibold text-sm text-foreground">Core Service Area</span>
                <span className="ml-auto text-xs bg-green-500/20 text-green-300 font-semibold px-2 py-0.5 rounded-full">Available</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-1">Located within our primary service area. These locations receive the highest booking priority and are serviced regularly.</p>
              <p className="text-xs text-muted-foreground/70">{CORE_SUBURBS.join(' · ')}</p>
            </div>

            {/* Extended */}
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Circle className="w-4 h-4 text-blue-400 fill-blue-400" />
                <span className="font-semibold text-sm text-foreground">Extended Service Area</span>
                <span className="ml-auto text-xs bg-blue-500/20 text-blue-300 font-semibold px-2 py-0.5 rounded-full">Available</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-1">Located within our extended service area. Availability may vary depending on demand and route planning.</p>
              <p className="text-xs text-muted-foreground/70">{EXTENDED_SUBURBS.join(' · ')}</p>
            </div>

            {/* Additional */}
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <span className="font-semibold text-sm text-foreground">Additional Locations</span>
                <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-300 font-semibold px-2 py-0.5 rounded-full">Review Required</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">We may still be able to service your area depending on availability and route planning. Requests outside our standard service zones are reviewed individually.</p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}