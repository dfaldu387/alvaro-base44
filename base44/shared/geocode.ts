// Shared Mapbox Geocoding helper — used by geocodeAddress (admin) and
// other server-side geocoding needs. The Mapbox public token is read from
// the CUTDELUXEMAP / MAPBOX_ACCESS_TOKEN secret and never exposed to the
// frontend.

export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number; formatted_address?: string } | null> {
  const token = process.env.CUTDELUXEMAP || process.env.MAPBOX_ACCESS_TOKEN;
  if (!token || !address) return null;

  try {
    const params = new URLSearchParams({
      access_token: token,
      country: 'au',
      limit: '1',
      language: 'en',
    });
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?${params}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const f = data.features[0];
      return { lat: f.center[1], lng: f.center[0], formatted_address: f.place_name };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Find the nearest active service zone to a given point by Haversine distance.
// Returns { zone, distanceKm } or null when no zones have coordinates.
// Used for location tier classification (core / extended / additional / outside).
export function findNearestZone(lat: number, lng: number, activeAreas: any[]): { zone: any; distanceKm: number } | null {
  let nearest = null;
  let minDist = Infinity;
  for (const area of (activeAreas || [])) {
    if (area.latitude == null || area.longitude == null) continue;
    const dist = haversineKm(lat, lng, area.latitude, area.longitude);
    if (dist < minDist) {
      minDist = dist;
      nearest = area;
    }
  }
  return nearest ? { zone: nearest, distanceKm: minDist } : null;
}

// Haversine distance in kilometres between two lat/lng points.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}