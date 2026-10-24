import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { placesDetails } from '../../shared/googlePlaces.ts';

// Returns coordinates and address components for a selected Google Place
// (New API). Used only by the admin Service Zone / team start-location editors,
// and every call is billed by Google, so the caller must be signed in as an admin
// or as an active staff member (the gate runs before any Google request).
// Returns { lat, lng, formatted_address, postcode, suburb, error }.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }
    const placeId = String(body.place_id || '').trim();
    if (!placeId) {
      return Response.json({ error: 'place_id is required.' });
    }

    const result = await placesDetails(placeId);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message });
  }
}