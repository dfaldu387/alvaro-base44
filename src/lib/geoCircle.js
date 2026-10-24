// Generate a GeoJSON Polygon approximating a circle on the Earth's surface
// from a centre point and radius in kilometres. Uses the great-circle
// formula to produce accurate boundaries at any latitude.
export function generateCirclePolygon(lat, lng, radiusKm, points = 64) {
  const coords = [];
  const earthRadiusKm = 6371;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angularRadius = radiusKm / earthRadiusKm;

  for (let i = 0; i <= points; i++) {
    const bearing = (2 * Math.PI * i) / points;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angularRadius) +
        Math.cos(latRad) * Math.sin(angularRadius) * Math.cos(bearing)
    );
    const lng2 = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(latRad),
      Math.cos(angularRadius) - Math.sin(latRad) * Math.sin(lat2)
    );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }

  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}

// Generate the three concentric coverage polygons (Core, Extended, Maximum)
// for a zone centre, using the global Booking Rules radius settings. Used by
// every map to visualise the tier boundaries — there is no per-zone radius.
export function generateTierPolygons(lat, lng, settings) {
  const core = settings?.core_radius_km || 15;
  const extended = settings?.extended_radius_km || 25;
  const maximum = settings?.maximum_service_radius_km || 35;
  return {
    core: generateCirclePolygon(lat, lng, core),
    extended: generateCirclePolygon(lat, lng, extended),
    maximum: generateCirclePolygon(lat, lng, maximum),
  };
}