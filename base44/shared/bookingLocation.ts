/**
 * Booking location — the one place an address becomes a service tier, a matched
 * zone and the zone scheduled for the date.
 *
 * Shared by:
 *   - the public booking endpoint   (submitPublicBooking)
 *   - the admin edit endpoint       (updateBookingRequest)
 *
 * The backend is the only authority here: a frontend-supplied tier, matched
 * zone, distance or eligibility is never trusted, and the Maximum Radius is a
 * hard boundary. An edited address is therefore classified by exactly the same
 * rules as a newly submitted one.
 */

import { calculateServiceCoverage, validateCoverageConfig } from './serviceCoverage.ts';
import {
  getServiceCentre,
  getExtendedRadiusKm,
  getMaxServiceRadiusKm,
  DEFAULT_MAX_SERVICE_RADIUS_KM,
} from './groupPricing.ts';

export interface ResolvedBookingLocation {
  ok: boolean;
  error: string | null;
  /** HTTP status the caller should use when `ok` is false. */
  status: number;
  coverage: any;
  location_tier: string | null;
  matched_service_zone_id: string;
  matched_service_zone_name: string;
  matched_service_zone_colour: string;
  distance_from_zone_km: number | null;
  service_area_id: string;
  service_area_name: string;
  priority_status: string | null;
  service_zone_id: string | null;
  service_zone_name: string;
  service_zone_colour: string;
  team_member_id: string | null;
  team_member_name: string;
}

function emptyLocation(error: string | null, status: number, coverage: any = null): ResolvedBookingLocation {
  return {
    ok: !error,
    error,
    status,
    coverage,
    location_tier: null,
    matched_service_zone_id: '',
    matched_service_zone_name: '',
    matched_service_zone_colour: '',
    distance_from_zone_km: null,
    service_area_id: '',
    service_area_name: '',
    priority_status: null,
    service_zone_id: null,
    service_zone_name: '',
    service_zone_colour: '',
    team_member_id: null,
    team_member_name: '',
  };
}

/**
 * Classifies one service address against the saved Service Coverage
 * configuration, and resolves the Service Zone scheduled for the booking's day.
 * Returns `ok: false` (with the customer-facing message and status) when the
 * address is unusable, the coverage configuration is broken, or the address
 * falls outside the Maximum Radius.
 */
export function resolveBookingLocation({
  latitude,
  longitude,
  activeAreas = [],
  settings,
  day = '',
}: {
  latitude: number;
  longitude: number;
  activeAreas?: any[];
  settings: any;
  day?: string;
}): ResolvedBookingLocation {
  const centre = getServiceCentre(settings);
  const extendedRadiusKm = getExtendedRadiusKm(settings);
  const maximumRadiusKm = getMaxServiceRadiusKm(settings) || DEFAULT_MAX_SERVICE_RADIUS_KM;

  // Fail safely when coverage is not configured — never allow everything.
  const configCheck = validateCoverageConfig(centre, extendedRadiusKm, maximumRadiusKm);
  if (!configCheck.valid) {
    return emptyLocation(
      "We couldn't verify service availability for this location. Please try again.",
      500,
    );
  }

  if (typeof latitude !== 'number' || typeof longitude !== 'number'
    || !isFinite(latitude) || !isFinite(longitude)) {
    return emptyLocation("We couldn't verify your service address. Please select it again.", 400);
  }

  const coverage = calculateServiceCoverage({
    latitude,
    longitude,
    activeZones: activeAreas || [],
    coverageCentre: centre,
    extendedRadiusKm,
    maximumRadiusKm,
  });

  // Hard boundary: an address beyond the Maximum Radius cannot be serviced.
  if (coverage.tier === 'outside') {
    return emptyLocation("We're not currently servicing this location.", 400, coverage);
  }

  // The Service Zone scheduled for the selected date's day of week — separate
  // from coverage eligibility. It sets the booking's zone colour and barber.
  const dayZones = (activeAreas || []).filter((a: any) =>
    (a?.service_days || []).some((d: any) => d.enabled && d.day_of_week === day)
  );
  const scheduledZone = dayZones[0] || null;

  return {
    ok: true,
    error: null,
    status: 200,
    coverage,
    location_tier: coverage.tier,
    matched_service_zone_id: coverage.matchedZoneId || '',
    matched_service_zone_name: coverage.matchedZoneName || '',
    matched_service_zone_colour: coverage.matchedZoneColour || '',
    distance_from_zone_km: coverage.distanceFromZoneKm ?? null,
    service_area_id: coverage.matchedZoneId || '',
    service_area_name: coverage.matchedZoneName || '',
    priority_status: coverage.tier === 'priority' ? 'priority' : 'outside_priority',
    service_zone_id: scheduledZone ? scheduledZone.id : null,
    service_zone_name: scheduledZone?.name || '',
    service_zone_colour: scheduledZone?.colour || (scheduledZone ? '#6f22cf' : ''),
    team_member_id: scheduledZone?.team_member_id || null,
    team_member_name: scheduledZone?.team_member_name || '',
  };
}