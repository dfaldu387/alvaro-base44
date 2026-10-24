// Haversine distance in kilometres between a customer location and the
// global service centre. Returns null when the centre is not configured.
export function distanceFromCentre(lat, lng, centre) {
  if (!centre || centre.lat == null || centre.lng == null) return null;
  return haversineKm(lat, lng, centre.lat, centre.lng);
}

// Haversine distance in kilometres between two lat/lng points.
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Find all active service areas within the maximum service radius of the
// given point. The hard service boundary comes from the global Booking Rules
// (radiusSettings.maximum_service_radius_km) — there is no per-zone radius.
// Returns array of { area, distanceKm } sorted by distance ascending.
// Zones without a centre point (lat/lng) are skipped.
export function matchZonesByLocation(lat, lng, serviceAreas) {
  const matches = [];
  for (const area of serviceAreas) {
    if (area.latitude == null || area.longitude == null) continue;
    const dist = haversineKm(lat, lng, area.latitude, area.longitude);
    const radius = area.radius_km || 10;
    if (dist <= radius) {
      matches.push({ area, distanceKm: dist });
    }
  }
  matches.sort((a, b) => a.distanceKm - b.distanceKm);
  return matches;
}

// Returns the shortest distance (km) from the given point to any active
// service area centre, or null when no zones have coordinates. Used to
// check the maximum service radius boundary for outside-priority customers.
export function nearestZoneDistance(lat, lng, serviceAreas) {
  let minDist = Infinity;
  for (const area of serviceAreas) {
    if (area.latitude == null || area.longitude == null) continue;
    const dist = haversineKm(lat, lng, area.latitude, area.longitude);
    if (dist < minDist) minDist = dist;
  }
  return minDist === Infinity ? null : minDist;
}

// Find the nearest active service zone by Haversine distance.
// Returns { area, distanceKm } or null when no zones have coordinates.
export function findNearestZone(lat, lng, serviceAreas) {
  let nearest = null;
  let minDist = Infinity;
  for (const area of (serviceAreas || [])) {
    if (area.latitude == null || area.longitude == null) continue;
    const dist = haversineKm(lat, lng, area.latitude, area.longitude);
    if (dist < minDist) {
      minDist = dist;
      nearest = area;
    }
  }
  return nearest ? { area: nearest, distanceKm: minDist } : null;
}

// Classify a distance (km) into a location tier using saved radius settings.
// Returns 'core' | 'extended' | 'additional' | 'outside'.
// Frontend uses this for display only — the backend recalculates authoritatively.
export function calculateLocationTier(distanceKm, settings) {
  const core = settings?.core_radius_km || 15;
  const extended = settings?.extended_radius_km || 25;
  const maximum = settings?.maximum_service_radius_km || 35;
  if (distanceKm <= core) return 'core';
  if (distanceKm <= extended) return 'extended';
  if (distanceKm <= maximum) return 'additional';
  return 'outside';
}

// Full customer location classification using the same backend source of truth
// as the admin Service Coverage page. Shared by admin and booking maps.
//
// 1. If the customer is inside any active Service Zone radius → 'priority'
//    (returns the nearest matched zone).
// 2. Otherwise, checks distance from the global Coverage Centre:
//    - <= extended_radius_km → 'extended' (outside priority, standard serviceable)
//    - <= maximum_radius_km → 'additional' (outer serviceable)
//    - > maximum_radius_km   → 'outside' (not currently serviceable)
//
// `coverage` shape: { centre: { latitude, longitude } | null, extended_radius_km, maximum_radius_km }
export function classifyCustomerLocation(lat, lng, serviceAreas, coverage) {
  const zoneMatches = matchZonesByLocation(lat, lng, serviceAreas);
  if (zoneMatches.length > 0) {
    return {
      tier: 'priority',
      matchedZone: zoneMatches[0].area,
      distanceFromZoneKm: zoneMatches[0].distanceKm,
      allZoneMatches: zoneMatches,
    };
  }

  if (!coverage?.centre) {
    return { tier: 'outside', matchedZone: null, distanceFromCentreKm: null };
  }

  const distFromCentre = haversineKm(lat, lng, coverage.centre.latitude, coverage.centre.longitude);
  const extended = coverage.extended_radius_km || 25;
  const maximum = coverage.maximum_radius_km || 35;

  if (distFromCentre <= extended) {
    return { tier: 'extended', matchedZone: null, distanceFromCentreKm: distFromCentre };
  }
  if (distFromCentre <= maximum) {
    return { tier: 'additional', matchedZone: null, distanceFromCentreKm: distFromCentre };
  }
  return { tier: 'outside', matchedZone: null, distanceFromCentreKm: distFromCentre };
}