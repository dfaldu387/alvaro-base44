// Authoritative server-side service coverage calculation.
// Shared by submitPublicBooking (and any future backend function that needs
// to decide customer eligibility). The backend is the single source of
// truth — frontend-provided tier / matched-zone / distance / eligibility
// values are NEVER trusted and are always recalculated from saved records.

import { haversineKm } from './geocode.ts';

// Validates that the saved Service Coverage configuration is usable for
// eligibility decisions. When invalid, the backend must fail safely and
// reject all submissions — it must never accidentally allow every booking.
//
// Requirements:
//   - Coverage Centre: valid lat/lng within range
//   - Extended Radius: > 0
//   - Maximum Radius: > 0
//   - Maximum Radius >= Extended Radius
export function validateCoverageConfig(
  centre: { lat: number; lng: number } | null,
  extendedRadiusKm: number,
  maximumRadiusKm: number,
): { valid: boolean; error: string | null } {
  if (!centre || centre.lat == null || centre.lng == null ||
      !isFinite(centre.lat) || !isFinite(centre.lng) ||
      Math.abs(centre.lat) > 90 || Math.abs(centre.lng) > 180) {
    return { valid: false, error: 'Coverage centre is not configured or invalid.' };
  }
  if (!(extendedRadiusKm > 0) || !isFinite(extendedRadiusKm)) {
    return { valid: false, error: 'Extended radius must be greater than 0.' };
  }
  if (!(maximumRadiusKm > 0) || !isFinite(maximumRadiusKm)) {
    return { valid: false, error: 'Maximum radius must be greater than 0.' };
  }
  if (maximumRadiusKm < extendedRadiusKm) {
    return { valid: false, error: 'Maximum radius must be >= extended radius.' };
  }
  return { valid: true, error: null };
}

// Authoritative server-side service coverage calculation.
//
// Tier rules (in order):
//   1. priority — customer is inside at least one active Service Zone radius
//   2. extended — outside all zones, but within Extended Radius of Coverage Centre
//   3. outer    — outside Extended, but within Maximum Radius of Coverage Centre
//   4. outside  — beyond Maximum Radius (booking rejected)
//
// Only active zones count — inactive zones are never considered. When inside
// multiple active zones, the closest matching zone is selected as the
// authoritative matched zone.
//
// Uses proper Haversine geographic distance (not raw lat/lng subtraction).
//
// Returns a normalized result:
//   {
//     tier: 'priority' | 'extended' | 'outer' | 'outside',
//     allowed: boolean,
//     matchedZoneId: string | null,
//     matchedZoneName: string | null,
//     matchedZoneColour: string | null,
//     distanceFromZoneKm: number | null,        // distance to nearest active zone centre
//     distanceFromCoverageCentreKm: number | null,
//   }
export function calculateServiceCoverage({
  latitude,
  longitude,
  activeZones,
  coverageCentre,
  extendedRadiusKm,
  maximumRadiusKm,
}: {
  latitude: number;
  longitude: number;
  activeZones: any[];
  coverageCentre: { lat: number; lng: number } | null;
  extendedRadiusKm: number;
  maximumRadiusKm: number;
}): {
  tier: 'priority' | 'extended' | 'outer' | 'outside';
  allowed: boolean;
  matchedZoneId: string | null;
  matchedZoneName: string | null;
  matchedZoneColour: string | null;
  distanceFromZoneKm: number | null;
  distanceFromCoverageCentreKm: number | null;
} {
  const round1 = (n: number) => Math.round(n * 10) / 10;

  // Find the nearest active zone and all zones the customer is inside.
  let nearestZone: any = null;
  let nearestDistance = Infinity;
  const insideZones: { zone: any; distanceKm: number }[] = [];

  for (const zone of (activeZones || [])) {
    if (zone.latitude == null || zone.longitude == null) continue;
    const dist = haversineKm(latitude, longitude, zone.latitude, zone.longitude);
    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearestZone = zone;
    }
    const zoneRadius = zone.radius_km || 10;
    if (dist <= zoneRadius) {
      insideZones.push({ zone, distanceKm: dist });
    }
  }

  // Closest matching active zone is authoritative.
  insideZones.sort((a, b) => a.distanceKm - b.distanceKm);
  const nearestZoneDistanceKm = nearestZone ? round1(nearestDistance) : null;

  if (insideZones.length > 0) {
    const matched = insideZones[0];
    return {
      tier: 'priority',
      allowed: true,
      matchedZoneId: matched.zone.id,
      matchedZoneName: matched.zone.name || null,
      matchedZoneColour: matched.zone.colour || null,
      distanceFromZoneKm: round1(matched.distanceKm),
      distanceFromCoverageCentreKm: null,
    };
  }

  // Not inside any active zone — classify by distance from Coverage Centre.
  if (!coverageCentre || coverageCentre.lat == null || coverageCentre.lng == null) {
    return {
      tier: 'outside',
      allowed: false,
      matchedZoneId: null,
      matchedZoneName: null,
      matchedZoneColour: null,
      distanceFromZoneKm: nearestZoneDistanceKm,
      distanceFromCoverageCentreKm: null,
    };
  }

  const distFromCentre = haversineKm(
    latitude, longitude,
    coverageCentre.lat, coverageCentre.lng,
  );
  const roundedCentreDist = round1(distFromCentre);

  if (distFromCentre <= extendedRadiusKm) {
    return {
      tier: 'extended',
      allowed: true,
      matchedZoneId: null,
      matchedZoneName: null,
      matchedZoneColour: null,
      distanceFromZoneKm: nearestZoneDistanceKm,
      distanceFromCoverageCentreKm: roundedCentreDist,
    };
  }
  if (distFromCentre <= maximumRadiusKm) {
    return {
      tier: 'outer',
      allowed: true,
      matchedZoneId: null,
      matchedZoneName: null,
      matchedZoneColour: null,
      distanceFromZoneKm: nearestZoneDistanceKm,
      distanceFromCoverageCentreKm: roundedCentreDist,
    };
  }
  return {
    tier: 'outside',
    allowed: false,
    matchedZoneId: null,
    matchedZoneName: null,
    matchedZoneColour: null,
    distanceFromZoneKm: nearestZoneDistanceKm,
    distanceFromCoverageCentreKm: roundedCentreDist,
  };
}