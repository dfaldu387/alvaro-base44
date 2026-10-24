import React, { useState, lazy, Suspense } from 'react';
import { MapPin, Check, AlertCircle, ChevronRight, Navigation } from 'lucide-react';
const RegionMap = lazy(() => import('@/components/booking/RegionMap'));
import CustomerLocationSearch from '@/components/booking/CustomerLocationSearch';
import { matchZonesByLocation, classifyCustomerLocation } from '@/lib/geoDistance';
import { Button } from '@/components/ui/button';

// Step 1 — Region: "Where are you?"
// Customer searches their suburb/address via Google Places autocomplete.
// The selected location's coordinates are checked against every active
// ServiceArea radius (Haversine). The closest matching zone is selected
// automatically. If outside all zones, the customer continues into the
// Review Required / outside-priority flow.
export default function RegionStep({
  serviceAreas,
  selectedAreaId,
  priorityStatus,
  onSelectArea,
  onSelectOutside,
  onContinue,
  loading,
  loadError,
  onRetry,
  customerLocation,
  onCustomerLocationChange,
  radiusSettings,
  serviceCoverage,
}) {
  const [matchResult, setMatchResult] = useState(null);
  const [locationTier, setLocationTier] = useState(null);

  const selectedArea = serviceAreas.find(a => a.id === selectedAreaId) || null;
  const isOutside = priorityStatus === 'outside_priority' && !selectedAreaId;
  const hasValidCoords = customerLocation?.lat != null && customerLocation?.lng != null;
  const canContinue = hasValidCoords && (!!selectedAreaId || isOutside) && locationTier !== 'outside';

  const handleLocationSelect = (place) => {
    onCustomerLocationChange(place);
    const result = classifyCustomerLocation(place.lat, place.lng, serviceAreas, serviceCoverage);
    if (result.tier === 'priority') {
      setLocationTier('core');
      setMatchResult({ matchedArea: result.matchedZone, allMatches: result.allZoneMatches, isOutside: false, tier: 'priority' });
      onSelectArea(result.matchedZone.id);
    } else if (result.tier === 'outside') {
      setLocationTier('outside');
      setMatchResult({ matchedArea: null, allMatches: [], isOutside: true, tier: 'outside' });
      onSelectOutside();
    } else {
      // 'extended' or 'additional' — outside priority zones but still serviceable
      setLocationTier(result.tier);
      setMatchResult({ matchedArea: null, allMatches: [], isOutside: true, tier: result.tier });
      onSelectOutside();
    }
  };

  const handleInvalidate = () => {
    onCustomerLocationChange(null);
    setMatchResult(null);
    setLocationTier(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Loading service areas…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <p className="text-sm font-semibold text-foreground mb-1">Service area information is temporarily unavailable.</p>
        <p className="text-xs text-muted-foreground mb-4">Please try again.</p>
        <Button variant="outline" onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  if (!serviceAreas || serviceAreas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <MapPin className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground mb-1">No service areas are currently available.</p>
        <p className="text-xs text-muted-foreground">Please contact us to book.</p>
      </div>
    );
  }

  const showMatchedCard = matchResult && !matchResult.isOutside && matchResult.matchedArea && matchResult.matchedArea.id === selectedAreaId;
  const showExtendedCard = matchResult?.tier === 'extended' && !selectedAreaId;
  const showOuterCard = matchResult?.tier === 'additional' && !selectedAreaId;

  return (
    <div className="space-y-5">
      {/* Heading */}
      <div>
        <h2 className="text-xl font-heading font-bold">Where are you?</h2>
        <p className="text-sm text-muted-foreground mt-1">Search your suburb or address and we'll match you to a service zone.</p>
      </div>

      {/* Search */}
      <CustomerLocationSearch
        onSelect={handleLocationSelect}
        onInvalidate={handleInvalidate}
        initialValue={customerLocation?.formatted_address || ''}
        placeholder="Search your suburb or address"
      />

      {/* Map — shows all zones, customer marker, highlights matched zone */}
      <div className="mb-2">
        <Suspense fallback={
          <div className="rounded-2xl border border-border overflow-hidden h-[300px] flex items-center justify-center bg-card">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <RegionMap
            areas={serviceAreas}
            selectedId={selectedAreaId}
            onSelect={onSelectArea}
            customerLocation={customerLocation}
            radiusSettings={radiusSettings}
            serviceCoverage={serviceCoverage}
          />
        </Suspense>
      </div>

      {/* Matched zone card */}
      {showMatchedCard && (
        <div className="rounded-2xl border border-primary bg-primary/10 p-4 shadow-[0_0_20px_rgba(139,61,255,0.15)]">
          <div className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: matchResult.matchedArea.colour || '#6f22cf' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{matchResult.matchedArea.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{customerLocation?.formatted_address}</p>
            </div>
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-2.5">
            <Navigation className="w-3 h-3 text-primary" />
            <p className="text-xs text-primary font-medium">Inside our service area</p>
          </div>
        </div>
      )}

      {/* Extended service area — outside priority zones, inside extended radius */}
      {showExtendedCard && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Extended service area</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{customerLocation?.formatted_address}</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">You're outside our priority zones, but still within our extended coverage. Submit your request and we'll fit it into the route where possible.</p>
            </div>
          </div>
        </div>
      )}

      {/* Outer service area — outside extended radius, inside maximum radius */}
      {showOuterCard && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Outer service area</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{customerLocation?.formatted_address}</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">You're outside our extended coverage, but still within our maximum service range. Submit your request and we'll review whether we can fit it into the route.</p>
            </div>
          </div>
        </div>
      )}

      {/* Outside maximum service radius — blocked */}
      {locationTier === 'outside' && customerLocation && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Outside our current service area</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">We're not currently servicing this location.</p>
            </div>
          </div>
        </div>
      )}

      {/* Manual outside-priority fallback (only before a search is done) */}
      {!matchResult && (
        <button
          onClick={onSelectOutside}
          className={`w-full rounded-2xl border p-4 text-left transition-all ${
            isOutside
              ? 'border-primary/40 bg-primary/[0.07]'
              : 'border-dashed border-white/[0.12] bg-white/[0.02] hover:border-primary/30'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Outside our priority area</p>
              <p className="text-xs text-muted-foreground mt-0.5">You can still request a booking. Clients within our scheduled service region are prioritised when routes are finalised.</p>
            </div>
            {isOutside && (
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                <Check className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
            )}
          </div>
        </button>
      )}

      {/* Continue */}
      <div className="sticky bottom-0 -mx-5 border-t border-white/[0.06] bg-background/95 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:-top-10 before:h-10 before:bg-gradient-to-t before:from-background before:to-transparent">
        {selectedArea && hasValidCoords && (
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedArea.colour || '#6f22cf' }} />
            <span className="font-semibold text-foreground">{selectedArea.name}</span>
            <span>· Priority area</span>
          </div>
        )}
        {!hasValidCoords && (
          <p className="text-xs text-muted-foreground mb-3">Select an address from the suggestions to continue.</p>
        )}
        <Button className="w-full h-12 rounded-full text-[15px] font-semibold" disabled={!canContinue} onClick={onContinue}>
          Continue <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}