/**
 * Booking items — the one place a booking's services, duration and price are
 * worked out from the catalogue.
 *
 * Shared by:
 *   - the public booking endpoint   (submitPublicBooking)
 *   - the admin edit endpoint       (updateBookingRequest)
 *
 * So an edited request is repriced and re-timed by exactly the same rules as a
 * newly submitted one: prices and durations always come from the active Service
 * and AddOn catalogue, and a client-supplied price is never trusted.
 */

import {
  computePeopleCount,
  isGroupBooking,
  CALLOUT_FEE,
  computeGroupDiscount,
  getApplicableTier,
  getMaxGroupBookingPeople,
} from './groupPricing.ts';

const key = (value: unknown) => String(value == null ? '' : value).trim().toLowerCase();

export interface Catalogue {
  price: (name: string) => number;
  duration: (name: string) => number;
  addonPrice: (name: string) => number;
  addonDuration: (name: string) => number;
}

/**
 * Name-keyed price/duration lookup built from the catalogue.
 * Inactive items are ignored and the first entry for a name wins, so a
 * duplicated name can never change what a booking costs.
 */
export function buildCatalogue(services: any[] = [], addons: any[] = []): Catalogue {
  const priceByName: Record<string, number> = {};
  const durationByName: Record<string, number> = {};
  for (const s of services || []) {
    if (s?.is_active === false) continue;
    const k = key(s?.name);
    if (k && !(k in priceByName)) {
      priceByName[k] = s.price || 0;
      durationByName[k] = s.duration_mins || 0;
    }
  }

  const addonPriceByName: Record<string, number> = {};
  const addonDurationByName: Record<string, number> = {};
  for (const a of addons || []) {
    if (a?.is_active === false) continue;
    const k = key(a?.name);
    if (k && !(k in addonPriceByName)) {
      addonPriceByName[k] = a.price_adjustment || 0;
      addonDurationByName[k] = a.duration_adjustment || 0;
    }
  }

  return {
    price: (name: string) => priceByName[key(name)] || 0,
    duration: (name: string) => durationByName[key(name)] || 0,
    addonPrice: (name: string) => addonPriceByName[key(name)] || 0,
    addonDuration: (name: string) => addonDurationByName[key(name)] || 0,
  };
}

/**
 * A flat service-list edit (the calendar side panel) is only safe on a booking
 * for one person. `participants` is what occupancy is timed from, so it is
 * rebuilt here from the same list that `services` will hold: the two can never
 * disagree. A group booking, or a list that would need a second person (a second
 * primary service), is refused with a readable reason instead of being flattened.
 */
export function planFlatServiceEdit({ currentParticipants, services, addonNames }: {
  currentParticipants?: any[] | null;
  services: any[];
  addonNames: string[];
}): { ok: true; participants: { primary_service: string; addons: string[] }[] } | { ok: false; error: string } {
  const GROUP = 'This is a group booking. Change its services with Edit on the booking in Bookings so every person keeps their own service.';
  const existing = Array.isArray(currentParticipants) ? currentParticipants.filter((p: any) => p?.primary_service || (p?.addons || []).length) : [];
  if (existing.length > 1) return { ok: false, error: GROUP };

  const addonKeys = new Set((addonNames || []).map(key));
  const names = (Array.isArray(services) ? services : []).map((s: any) => String(s || '').trim()).filter(Boolean);
  const primaries = names.filter(n => !addonKeys.has(key(n)));
  if (primaries.length > 1) {
    return { ok: false, error: 'More than one main service means more than one person. Use Edit on the booking in Bookings to change a group.' };
  }
  const primary = primaries[0] || '';
  return {
    ok: true,
    participants: [{ primary_service: primary, addons: names.filter(n => addonKeys.has(key(n))) }],
  };
}

export interface RecalculatedItems {
  /** Flat list of every service/add-on name, in participant order. */
  names: string[];
  /** Normalised participants (one primary service each, plus add-ons). */
  participants: { primary_service: string; addons: string[] }[];
  subtotal: number;
  durationMins: number;
  peopleCount: number;
  maxPeople: number;
  /** True when the booking exceeds the configured maximum group size. */
  overMax: boolean;
  tier: any;
  groupDiscount: number;
  calloutFee: number;
  totalPrice: number;
  isGroupBooking: boolean;
}

/**
 * Recalculates everything about a booking that follows from its services:
 * per-person duration and price, the group size, and the discount and callout
 * fees that apply. Reads the catalogue only — never the caller's numbers.
 */
export function recalculateBookingItems({
  services = [],
  participants = [],
  catalogue,
  settings,
  afterHoursMode = null,
  afterHoursSlot = null,
}: {
  services?: any[];
  participants?: any[];
  catalogue: Catalogue;
  settings: any;
  afterHoursMode?: string | null;
  afterHoursSlot?: string | null;
}): RecalculatedItems {
  const people = (Array.isArray(participants) ? participants : [])
    .map((p: any) => ({
      primary_service: String(p?.primary_service || '').trim(),
      addons: (Array.isArray(p?.addons) ? p.addons : [])
        .map((a: any) => String(a || '').trim())
        .filter(Boolean),
    }))
    .filter(p => p.primary_service || p.addons.length > 0);

  const names: string[] = [];
  let subtotal = 0;
  let durationMins = 0;

  if (people.length > 0) {
    for (const person of people) {
      if (person.primary_service) {
        names.push(person.primary_service);
        subtotal += catalogue.price(person.primary_service);
        durationMins += catalogue.duration(person.primary_service);
      }
      for (const addon of person.addons) {
        names.push(addon);
        subtotal += catalogue.addonPrice(addon);
        durationMins += catalogue.addonDuration(addon);
      }
    }
  } else {
    for (const raw of (Array.isArray(services) ? services : [])) {
      const name = String(raw || '').trim();
      if (!name) continue;
      names.push(name);
      subtotal += catalogue.price(name);
      durationMins += catalogue.duration(name);
    }
  }

  const peopleCount = people.length > 0 ? people.length : computePeopleCount(names);
  const maxPeople = getMaxGroupBookingPeople(settings);
  const tier = getApplicableTier(peopleCount, settings);
  const groupDiscount = computeGroupDiscount(peopleCount, subtotal, settings);
  const calloutFee = (afterHoursMode === 'mobile_callout' && afterHoursSlot) ? CALLOUT_FEE : 0;
  const totalPrice = Math.max(0, subtotal - groupDiscount + calloutFee);

  return {
    names,
    participants: people,
    subtotal,
    durationMins,
    peopleCount,
    maxPeople,
    overMax: peopleCount > maxPeople,
    tier,
    groupDiscount,
    calloutFee,
    totalPrice,
    isGroupBooking: isGroupBooking(peopleCount),
  };
}