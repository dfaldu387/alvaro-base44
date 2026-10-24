// Geometry validation and helper functions for service zone polygons.
// Used by both the admin map editor and the save flow.

// Parse a geometry field that may be stored as a JSON string in the database.
export function parseGeometry(geometry) {
  if (!geometry) return null;
  if (typeof geometry === 'string') {
    try { return JSON.parse(geometry); } catch { return null; }
  }
  return geometry;
}

// Stringify a geometry object for database storage.
export function stringifyGeometry(geometry) {
  if (!geometry) return null;
  if (typeof geometry === 'string') return geometry;
  return JSON.stringify(geometry);
}

// Validate a GeoJSON Polygon geometry.
// Returns { valid: true } or { valid: false, error: 'message' }.
export function validatePolygon(geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) {
    return { valid: false, error: 'No polygon drawn yet.' };
  }
  if (geometry.type !== 'Polygon') {
    return { valid: false, error: 'Only Polygon geometry is supported.' };
  }
  const ring = geometry.coordinates[0];
  if (!ring || ring.length < 4) {
    return { valid: false, error: 'Polygon must have at least 3 unique points.' };
  }
  // Check ring is closed (first point === last point)
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return { valid: false, error: 'Polygon ring must be closed.' };
  }
  // Check at least 3 unique points (excluding the closing duplicate)
  const unique = ring.slice(0, -1);
  const uniqueSet = new Set(unique.map((p) => `${p[0]},${p[1]}`));
  if (uniqueSet.size < 3) {
    return { valid: false, error: 'Polygon must have at least 3 unique points.' };
  }
  return { valid: true };
}

// Close a ring by appending the first point if not already closed.
export function closeRing(coords) {
  if (!coords || coords.length < 3) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return [...coords, first];
}

// Build a GeoJSON Polygon from an array of [lng, lat] coordinates.
export function polygonFromCoords(coords) {
  const closed = closeRing(coords);
  if (!closed) return null;
  return {
    type: 'Polygon',
    coordinates: [closed],
  };
}

// Extract the editable coordinates (without the closing duplicate) from a
// GeoJSON Polygon.
export function getPolygonCoords(geometry) {
  if (!geometry || geometry.type !== 'Polygon') return [];
  const ring = geometry.coordinates[0];
  if (!ring || ring.length === 0) return [];
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      return ring.slice(0, -1);
    }
  }
  return ring;
}

// Compute the bounding box of a GeoJSON Polygon.
export function getPolygonBounds(geometry) {
  if (!geometry || geometry.type !== 'Polygon') return null;
  const ring = geometry.coordinates[0];
  if (!ring || ring.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLng, minLat, maxLng, maxLat };
}

// Calculate the midpoint between two [lng, lat] coordinates.
export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Ray-casting point-in-polygon test.
// GeoJSON coordinates are [lng, lat] pairs, so x = longitude, y = latitude.
// Returns true when the point (lng, lat) is inside the polygon's outer ring.
export function pointInPolygon(lng, lat, geometry) {
  if (!validatePolygon(geometry).valid) return false;
  const ring = geometry.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Generate midpoint markers for a ring of coordinates (for the "add vertex"
// interaction). Returns an array of { position: [lng, lat], insertAfter: index }.
export function getMidpoints(coords) {
  if (!coords || coords.length < 3) return [];
  const mids = [];
  for (let i = 0; i < coords.length; i++) {
    const next = (i + 1) % coords.length;
    mids.push({
      position: midpoint(coords[i], coords[next]),
      insertAfter: i,
    });
  }
  return mids;
}