// Group booking pricing logic — shared by backend functions.
//
// A "group booking" is 2+ people booked together at the same location.
// people_count = number of explicit participants (see BookingRequest.participants).
// Discount tiers are configurable via the GroupDiscountSettings entity
// (business default + optional per-barber overrides). These functions take
// the resolved settings as an argument so discount values are never hard-coded.

export const CALLOUT_FEE = 50;

// Business-default discount configuration. Used when no GroupDiscountSettings
// record exists yet. Mirrors the frontend default in src/lib/groupPricing.js.
export const DEFAULT_SERVICE_CENTRE_LAT = -33.87;
export const DEFAULT_SERVICE_CENTRE_LNG = 151.21;

export const DEFAULT_GROUP_DISCOUNT_SETTINGS = {
  enabled: true,
  max_group_booking_people: 6,
  max_bookings_per_day: 8,
  service_centre_lat: DEFAULT_SERVICE_CENTRE_LAT,
  service_centre_lng: DEFAULT_SERVICE_CENTRE_LNG,
  service_centre_address: '',
  core_radius_km: 15,
  extended_radius_km: 25,
  maximum_service_radius_km: 35,
  tier_2_type: 'fixed',
  tier_2_amount: 10,
  tier_3_type: 'fixed',
  tier_3_amount: 21,
  tier_4plus_type: 'percentage',
  tier_4plus_amount: 10,
};

// Default maximum participants in a single public group booking.
export const DEFAULT_MAX_GROUP_BOOKING_PEOPLE = 6;

// Default maximum booking requests allowed per day. Drives the public
// day-status (available / filling up / limited / full). Counts actual
// bookings (requests), never add-ons.
export const DEFAULT_MAX_BOOKINGS_PER_DAY = 8;

// Default maximum service radius in kilometres. Customers outside this
// distance from any active service zone centre cannot submit a normal
// booking request. This is the hard service boundary from Booking Rules.
export const DEFAULT_MAX_SERVICE_RADIUS_KM = 35;

// Default core and extended radius thresholds for location tier classification.
export const DEFAULT_CORE_RADIUS_KM = 15;
export const DEFAULT_EXTENDED_RADIUS_KM = 25;

// Resolves the global service centre { lat, lng } from a settings record,
// falling back to the Sydney default when unset. This is the single origin
// point for all service-radius calculations and coverage visualisation.
export function getServiceCentre(settings) {
  const lat = settings && typeof settings.service_centre_lat === 'number' ? settings.service_centre_lat : null;
  const lng = settings && typeof settings.service_centre_lng === 'number' ? settings.service_centre_lng : null;
  if (lat != null && lng != null) return { lat, lng };
  return { lat: DEFAULT_SERVICE_CENTRE_LAT, lng: DEFAULT_SERVICE_CENTRE_LNG };
}

// Resolves the authoritative maximum service radius from a settings record.
// Returns null when unset or invalid, meaning no hard boundary is enforced.
export function getMaxServiceRadiusKm(settings) {
  const v = settings && typeof settings.maximum_service_radius_km === 'number'
    ? settings.maximum_service_radius_km
    : null;
  return v && v >= 1 ? v : null;
}

// Resolves the authoritative core radius from a settings record.
export function getCoreRadiusKm(settings) {
  const v = settings && typeof settings.core_radius_km === 'number' ? settings.core_radius_km : null;
  return v && v >= 1 ? v : DEFAULT_CORE_RADIUS_KM;
}

// Resolves the authoritative extended radius from a settings record.
export function getExtendedRadiusKm(settings) {
  const v = settings && typeof settings.extended_radius_km === 'number' ? settings.extended_radius_km : null;
  return v && v >= 1 ? v : DEFAULT_EXTENDED_RADIUS_KM;
}

// Classify a distance (km) into a location tier using saved radius settings.
// Returns 'core' | 'extended' | 'additional' | 'outside'.
// The backend is authoritative — the frontend uses this only for display.
export function classifyLocationTier(distanceKm, settings) {
  const core = getCoreRadiusKm(settings);
  const extended = getExtendedRadiusKm(settings);
  const maximum = getMaxServiceRadiusKm(settings) || DEFAULT_MAX_SERVICE_RADIUS_KM;
  if (distanceKm <= core) return 'core';
  if (distanceKm <= extended) return 'extended';
  if (distanceKm <= maximum) return 'additional';
  return 'outside';
}

// Resolves the authoritative per-day booking cap from a settings record,
// falling back to the built-in default when unset or invalid.
export function getMaxBookingsPerDay(settings) {
  const v = settings && typeof settings.max_bookings_per_day === 'number'
    ? settings.max_bookings_per_day
    : null;
  return v && v >= 1 ? v : DEFAULT_MAX_BOOKINGS_PER_DAY;
}

// Resolves the authoritative max group size from a settings record, falling
// back to the built-in default when unset or invalid.
export function getMaxGroupBookingPeople(settings) {
  const v = settings && typeof settings.max_group_booking_people === 'number'
    ? settings.max_group_booking_people
    : null;
  return v && v >= 1 ? v : DEFAULT_MAX_GROUP_BOOKING_PEOPLE;
}

export function isGroupBooking(peopleCount) {
  return (peopleCount || 0) >= 2;
}

// people_count fallback: the largest single-service quantity in the booking.
// Used only when no explicit participants list is provided.
export function computePeopleCount(services) {
  if (!Array.isArray(services) || services.length === 0) return 0;
  const counts = {};
  for (const s of services) {
    const name = String(s || '').trim().toLowerCase();
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  const vals = Object.values(counts);
  return vals.length ? Math.max(...vals) : 0;
}

// Returns the applicable discount tier for a given people count, or null.
// tier is '2' | '3' | '4+'. type is 'fixed' | 'percentage'.
export function getApplicableTier(peopleCount, settings) {
  const s = settings || DEFAULT_GROUP_DISCOUNT_SETTINGS;
  if (!s || !s.enabled || (peopleCount || 0) < 2) return null;
  if (peopleCount === 2) return { type: s.tier_2_type, amount: s.tier_2_amount, tier: '2' };
  if (peopleCount === 3) return { type: s.tier_3_type, amount: s.tier_3_amount, tier: '3' };
  if (peopleCount >= 4) return { type: s.tier_4plus_type, amount: s.tier_4plus_amount, tier: '4+' };
  return null;
}

// Computes the discount amount for a group booking from the authoritative
// settings. Percentage discounts are calculated against the subtotal.
export function computeGroupDiscount(peopleCount, subtotal, settings) {
  const tier = getApplicableTier(peopleCount, settings);
  if (!tier || !tier.amount) return 0;
  if (tier.type === 'percentage') {
    return Math.round(((subtotal || 0) * tier.amount / 100) * 100) / 100;
  }
  return tier.amount;
}