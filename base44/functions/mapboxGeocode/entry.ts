import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { mapboxGeocodeSearch } from '../../shared/mapboxGeocoding.ts';
import { hashIp, takeRateLimitSlot, PUBLIC_SEARCH_LIMITS } from '../../shared/bookingProtection.ts';

// Public endpoint — no auth required (the public booking form searches addresses
// before the customer has an account), so it is rate limited per caller instead:
// 30 searches a minute and 300 an hour, using the same one-way IP fingerprint as
// booking protection. Over the limit the answer is a plain 429 that says nothing
// about any address. If the limiter itself cannot be reached the search is allowed:
// a broken counter must never stop customers booking.
// Returns Mapbox Geocoding suggestions for a given input string. Each
// suggestion includes full structured address data and coordinates (no
// separate details call needed). Accepts optional lat/lng to bias results
// toward the customer's selected suburb/region (Step 1).
// Returns { suggestions, error }.
export default async function (req) {
  try {
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

    try {
      const admin = createClientFromRequest(req).asServiceRole;
      const verdict = await takeRateLimitSlot(admin, 'mapbox_geocode', await hashIp(req), PUBLIC_SEARCH_LIMITS);
      if (!verdict.allowed) {
        return Response.json(
          { suggestions: [], error: 'Too many searches. Please wait a moment and try again.' },
          { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
        );
      }
    } catch (e) {
      console.error('[mapboxGeocode] rate limiter unavailable, allowing the search', e?.message);
    }

    const proximity = (body.lat != null && body.lng != null)
      ? { lat: Number(body.lat), lng: Number(body.lng) }
      : null;

    const result = await mapboxGeocodeSearch(input, proximity);
    return Response.json(result);
  } catch (error) {
    return Response.json({ suggestions: [], error: "We couldn't search addresses right now. Please try again." });
  }
}