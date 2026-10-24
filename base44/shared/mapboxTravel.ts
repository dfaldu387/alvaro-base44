// Shared Mapbox Directions Matrix helper.
//
// ONE place that talks to Mapbox for road travel estimates, used by:
//   - mapboxDriveMatrix        (function — frontend Auto Sort / drive blocks)
//   - routeFlowEvaluateReshuffle (Reshuffle engine travel comparison)
//   - schedulingValidator      (Category 1 driving-feasibility validation)
//
// Road travel only — straight-line distance is never treated as proof that a
// drive is feasible. When the estimate cannot be obtained the caller must
// degrade safely (the validator returns TRAVEL_UNVERIFIED).

import { secrets } from 'base44:runtime';

export interface TravelPoint {
  lat: number;
  lng: number;
}

export interface DriveMatrixResult {
  ok: boolean;
  durations: number[][] | null; // seconds
  distances: number[][] | null; // metres
  error: string | null;
}

/** Mapbox limit for the Directions Matrix API. */
export const MAX_MATRIX_POINTS = 25;

export function getTravelToken(): string {
  try {
    return secrets.get('CUTDELUXEMAP') || secrets.get('MAPBOX_ACCESS_TOKEN') || '';
  } catch {
    return '';
  }
}

/**
 * Road driving time, honest to the minute.
 *
 * It is deliberately NOT padded up to a 5-minute mark: padding every leg inflated
 * a 12-minute drive to 15 and left a gap nobody could explain. The only rounding
 * happens once, on the appointment start, where the 5-minute increment belongs.
 */
export function toTravelMins(seconds: number | null | undefined): number | null {
  if (seconds == null || !isFinite(seconds)) return null;
  const mins = Math.round(seconds / 60);
  return mins > 0 ? mins : 1; // any road journey is at least a minute
}

function isUsablePoint(p: TravelPoint | null | undefined): boolean {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
    isFinite(p.lat) && isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/**
 * Road driving matrix between 2–25 points. Never throws — returns ok:false with
 * a reason so callers can fail safely instead of guessing.
 */
export async function mapboxDriveMatrix(points: TravelPoint[]): Promise<DriveMatrixResult> {
  const fail = (error: string): DriveMatrixResult => ({ ok: false, durations: null, distances: null, error });

  if (!Array.isArray(points) || points.length < 2) return fail('At least 2 coordinates are required.');
  if (points.length > MAX_MATRIX_POINTS) return fail(`Maximum ${MAX_MATRIX_POINTS} coordinates per request.`);
  if (!points.every(isUsablePoint)) return fail('Coordinates are incomplete or invalid.');

  const token = getTravelToken();
  if (!token) return fail('Mapbox token not configured.');

  const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordStr}?annotations=duration,distance&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      return fail(`Mapbox error: ${text}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.durations)) return fail('Mapbox returned no driving durations.');
    return {
      ok: true,
      durations: data.durations,
      distances: data.distances || null,
      error: null,
    };
  } catch (e) {
    return fail(e?.message || 'Mapbox request failed.');
  }
}