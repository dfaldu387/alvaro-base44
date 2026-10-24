// Frontend group-discount helpers. Mirrors the authoritative backend logic in
// base44/shared/groupPricing.ts. The backend always recalculates from the
// stored GroupDiscountSettings record on submission — these helpers are only
// for live preview in the booking flow.

export const DEFAULT_GROUP_DISCOUNT_SETTINGS = {
  enabled: true,
  max_group_booking_people: 6,
  max_bookings_per_day: 8,
  maximum_service_radius_km: 30,
  tier_2_type: 'fixed',
  tier_2_amount: 10,
  tier_3_type: 'fixed',
  tier_3_amount: 21,
  tier_4plus_type: 'percentage',
  tier_4plus_amount: 10,
};

export const DEFAULT_MAX_GROUP_BOOKING_PEOPLE = 6;

// Default maximum booking requests allowed per day. Drives the public
// day-status (available / filling up / limited / full). Counts actual
// bookings (requests), never add-ons.
export const DEFAULT_MAX_BOOKINGS_PER_DAY = 8;

// Default maximum service radius in kilometres. Customers outside this
// distance from any active service zone centre cannot submit a normal
// booking request. This is the hard service boundary from Booking Rules.
export const DEFAULT_MAX_SERVICE_RADIUS_KM = 30;

// Resolves the authoritative maximum service radius from a settings record.
// Returns null when unset or invalid, meaning no hard boundary is enforced.
export function getMaxServiceRadiusKm(settings) {
  const v = settings && typeof settings.maximum_service_radius_km === 'number'
    ? settings.maximum_service_radius_km
    : null;
  return v && v >= 1 ? v : null;
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

// Returns the applicable discount tier for a given people count, or null.
// tier is '2' | '3' | '4+'. type is 'fixed' | 'percentage'.
export function getApplicableTier(peopleCount, settings) {
  const s = settings || DEFAULT_GROUP_DISCOUNT_SETTINGS;
  if (!s || s.enabled === false || (peopleCount || 0) < 2) return null;
  if (peopleCount === 2) return { type: s.tier_2_type, amount: s.tier_2_amount, tier: '2' };
  if (peopleCount === 3) return { type: s.tier_3_type, amount: s.tier_3_amount, tier: '3' };
  if (peopleCount >= 4) return { type: s.tier_4plus_type, amount: s.tier_4plus_amount, tier: '4+' };
  return null;
}

// Computes the discount amount for a group booking from the configured
// settings. Percentage discounts are calculated against the subtotal.
export function computeGroupDiscount(peopleCount, subtotal, settings) {
  const tier = getApplicableTier(peopleCount, settings);
  if (!tier || !tier.amount) return 0;
  if (tier.type === 'percentage') {
    return Math.round(((subtotal || 0) * tier.amount / 100) * 100) / 100;
  }
  return tier.amount;
}