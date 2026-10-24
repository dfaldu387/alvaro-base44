import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { geocodeAddress } from '../../shared/geocode.ts';

/**
 * The day's road route, in the order the Calendar saved it.
 *
 * Google Routes API (computeRoutes) is asked for one route through the stops in
 * the order they are sent. Waypoint reordering is never enabled: the Calendar's
 * order is the plan, and this only draws and measures it.
 *
 * Coordinates come from the booking itself (the Mapbox pick on the booking form).
 * A stop without them is geocoded here, so the map has somewhere to put it. The
 * whole answer is returned to the caller — polyline, per-leg drive time, distance
 * and the day's driving total — so the Route tab never calculates travel twice.
 */
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = [
  'routes.polyline.encodedPolyline',
  'routes.distanceMeters',
  'routes.duration',
  'routes.legs.distanceMeters',
  'routes.legs.duration',
].join(',');

function seconds(value) {
  const n = Number(String(value ?? '').replace(/s$/, ''));
  return Number.isFinite(n) ? n : 0;
}

function minutes(value) {
  const secs = seconds(value);
  if (secs <= 0) return null;
  return Math.max(1, Math.round(secs / 60));
}

function km(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1000) * 10) / 10;
}

function coordinate(lat, lng) {
  return { location: { latLng: { latitude: lat, longitude: lng } } };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // Barbers and admins only: every day view spends a Google Routes request.
    if (user.role !== 'admin' && user.role !== 'user') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const body = await req.json().catch(() => ({}));
    const rawStops = Array.isArray(body?.stops) ? body.stops.slice(0, 25) : [];
    if (!rawStops.length) return Response.json({ ok: false, reason: 'no_stops', stops: [] });
    if (!apiKey) return Response.json({ ok: false, reason: 'no_key', stops: [] });

    const rawStart = body?.start;
    const start = rawStart && Number.isFinite(Number(rawStart.lat)) && Number.isFinite(Number(rawStart.lng))
      ? { lat: Number(rawStart.lat), lng: Number(rawStart.lng) }
      : null;

    // Where each stop actually is. Saved coordinates first; only a stop without
    // them is geocoded, so a normal day costs nothing extra.
    const stops = await Promise.all(rawStops.map(async (raw, index) => {
      const lat = Number(raw?.lat);
      const lng = Number(raw?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
        return { index, id: raw?.id ?? null, lat, lng };
      }
      const found = await geocodeAddress(String(raw?.address || ''));
      return {
        index,
        id: raw?.id ?? null,
        lat: found?.lat ?? null,
        lng: found?.lng ?? null,
      };
    }));

    const located = stops.filter((s) => s.lat != null && s.lng != null);
    const chain = start ? [{ index: -1, ...start }, ...located] : located;
    if (chain.length < 2) {
      // Nothing to drive between (one stop, or no usable address): the caller still
      // gets the markers, and says so in plain words instead of drawing a bad line.
      return Response.json({ ok: false, reason: 'not_enough_points', stops, legs: [] });
    }

    const origin = chain[0];
    const destination = chain[chain.length - 1];
    const intermediates = chain.slice(1, -1);

    const payload = {
      origin: coordinate(origin.lat, origin.lng),
      destination: coordinate(destination.lat, destination.lng),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      polylineQuality: 'HIGH_QUALITY',
      computeAlternativeRoutes: false,
      units: 'METRIC',
      ...(intermediates.length
        ? { intermediates: intermediates.map((p) => coordinate(p.lat, p.lng)) }
        : {}),
    };

    const response = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return Response.json({
        ok: false,
        reason: response.status === 401 || response.status === 403 ? 'api_not_enabled' : 'request_failed',
        detail: String(detail).slice(0, 300),
        stops,
        legs: [],
      });
    }

    const data = await response.json().catch(() => ({}));
    const route = data?.routes?.[0];
    if (!route) return Response.json({ ok: false, reason: 'no_route', stops, legs: [] });

    // legs[i] joins chain[i] to chain[i + 1]; index -1 is the barber's start location.
    const legs = (route.legs || []).map((leg, i) => ({
      from_index: chain[i]?.index ?? null,
      to_index: chain[i + 1]?.index ?? null,
      minutes: minutes(leg.duration),
      km: km(leg.distanceMeters),
    }));

    return Response.json({
      ok: true,
      polyline: route.polyline?.encodedPolyline || null,
      stops,
      legs,
      start_included: !!start,
      total_minutes: minutes(route.duration),
      total_km: km(route.distanceMeters),
    });
  } catch (error) {
    return Response.json({ ok: false, reason: 'failed', error: error.message, stops: [], legs: [] }, { status: 200 });
  }
}