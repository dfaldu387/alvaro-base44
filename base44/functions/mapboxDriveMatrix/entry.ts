import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { mapboxDriveMatrix } from '../../shared/mapboxTravel.ts';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';

// Returns an N×N driving-time matrix (seconds + metres) between a list of
// coordinates using the Mapbox Directions Matrix API. Used by the calendar
// Auto Sort and drive blocks. The Mapbox call itself lives in the shared
// travel module so the scheduling validator uses exactly the same estimates.
//
// Input:  { coordinates: [[lat, lng], [lat, lng], ...] }  (2–25 points)
// Output: { durations: number[][] (seconds), distances: number[][] (metres) }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    // Billed per call and only the admin calendar uses it: admin / active staff only.
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const coords = body.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return Response.json({ error: 'At least 2 coordinates are required.' }, { status: 400 });
    }
    if (coords.length > 25) {
      return Response.json({ error: 'Maximum 25 coordinates per request.' }, { status: 400 });
    }

    const result = await mapboxDriveMatrix(coords.map(c => ({ lat: c[0], lng: c[1] })));
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 502 });
    }

    return Response.json({
      durations: result.durations || [],
      distances: result.distances || [],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}