import { computeGroupDiscount, getApplicableTier } from '@/lib/groupPricing';

/**
 * Live estimate for the booking drawer's editor.
 *
 * The backend is authoritative: updateBookingRequest recalculates duration,
 * price, group size and discount from the catalogue every time. These helpers
 * exist only so the administrator can see what the edit is about to cost before
 * saving — they must never be used to write a price.
 */

/** One person's service line: their primary service plus any add-ons. */
export function lineForPerson(person, services = [], addons = []) {
  const primary = services.find(s => s.name === person?.primary_service);
  let mins = primary?.duration_mins || 0;
  let price = primary?.price || 0;
  for (const name of person?.addons || []) {
    const addon = addons.find(a => a.name === name);
    if (!addon) continue;
    mins += addon.duration_adjustment || 0;
    price += addon.price_adjustment || 0;
  }
  return { mins: Math.max(0, mins), price, service: primary || null };
}

/** Totals for the whole booking: subtotal, group discount, total and duration. */
export function estimateBooking(participants = [], services = [], addons = [], settings = null) {
  let subtotal = 0;
  let mins = 0;
  for (const person of participants) {
    const line = lineForPerson(person, services, addons);
    subtotal += line.price;
    mins += line.mins;
  }
  const people = Math.max(1, participants.length);
  const discount = computeGroupDiscount(people, subtotal, settings);
  const tier = getApplicableTier(people, settings);
  return {
    people,
    mins,
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round(Math.max(0, subtotal - discount) * 100) / 100,
    tier,
  };
}