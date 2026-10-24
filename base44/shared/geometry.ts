// Shared geometry helpers for service-zone polygon eligibility.
// Used by submitPublicBooking (backend) to determine whether a customer's
// geocoded location falls inside a ServiceArea's saved GeoJSON polygon.
//
// The same geometry stored on the ServiceArea entity (and rendered by
// ServiceZoneMap, ServiceAreaMap, and RegionMap) is parsed here for the
// authoritative point-in-polygon check.

// Parse a geometry field that may be stored as a JSON string in the database.
export function parseGeometry(geometry: any): any | null {
  if (!geometry) return null;
  if (typeof geometry === 'string') {
    try {
      return JSON.parse(geometry);
    } catch {
      return null;
    }
  }
  return geometry;
}

// Quick structural check that a geometry is a valid GeoJSON Polygon with
// a closed ring of at least 3 unique points.
export function isValidPolygon(geometry: any): boolean {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    return false;
  }
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  // Ring must be closed (first point === last point)
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) return false;
  // At least 3 unique points (excluding the closing duplicate)
  const unique = new Set(ring.slice(0, -1).map((p: number[]) => `${p[0]},${p[1]}`));
  return unique.size >= 3;
}

// Ray-casting point-in-polygon test.
// GeoJSON coordinates are [lng, lat] pairs, so:
//   x = longitude, y = latitude
// Returns true when the point (lng, lat) is inside the polygon's outer ring.
export function pointInPolygon(lng: number, lat: number, geometry: any): boolean {
  if (!isValidPolygon(geometry)) return false;
  const ring = geometry.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}