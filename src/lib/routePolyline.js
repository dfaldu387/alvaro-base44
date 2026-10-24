/**
 * Reading the road route Google returns.
 *
 * The polyline is encoded (Google's compressed lat/lng form); the map needs plain
 * [lng, lat] pairs. The legs are indexed by stop position, with -1 meaning the
 * barber's starting location, so "drive to the next stop" is one lookup rather
 * than a guess.
 */

/** Decode an encoded polyline into [[lng, lat], …] for the map. */
export function decodePolyline(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

/** The leg that leaves the stop at `fromIndex` (0-based stop order). */
export function legFrom(legs, fromIndex) {
  if (!Array.isArray(legs)) return null;
  return legs.find((leg) => leg.from_index === fromIndex) || null;
}

/** The leg that arrives at the first stop — the drive from the start location. */
export function firstLeg(legs) {
  return legFrom(legs, -1);
}

/** "12 min · 6.5 km" — one shape for every drive time on the map. */
export function driveLabel(leg) {
  if (!leg || leg.minutes == null) return null;
  return leg.km != null ? `${leg.minutes} min · ${leg.km} km` : `${leg.minutes} min`;
}