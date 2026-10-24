import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { placesAutocomplete } from '../../shared/googlePlaces.ts';

// Returns Google Places Autocomplete (New API) suggestions for a given
// input string. Used only by the admin Service Zone / team start-location editors,
// and every call is billed by Google, so the caller must be signed in as an admin
// or as an active staff member (the gate runs before any Google request).
// The API key stays server-side.
// Accepts optional lat/lng to bias results toward the selected region.
// Returns { suggestions, error }.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ suggestions: [], error: actor.error }, { status: actor.status });

    let body = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }
    const input = String(body.input || '').trim();
    if (input.length < 2) {
      return Response.json({ suggestions: [], error: null });
    }

    const locationBias = (body.lat != null && body.lng != null)
      ? { lat: Number(body.lat), lng: Number(body.lng) }
      : null;

    const result = await placesAutocomplete(input, locationBias);
    return Response.json(result);
  } catch (error) {
    return Response.json({ suggestions: [], error: error.message });
  }
}