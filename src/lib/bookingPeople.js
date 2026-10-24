import { computeGroupDiscount, getApplicableTier, getMaxGroupBookingPeople } from './groupPricing.js';

/**
 * People — the structure a manual booking is written from.
 *
 * A booking is a list of people, each with one primary service and any add-ons.
 * Two Haircuts is two people; a Beard is an add-on on one person and never a
 * person of its own. Everything here only PREVIEWS price and duration from the
 * catalogue: the server reprices every save from the same catalogue, so these
 * numbers can never become the booking's own truth.
 */

let sequence = 0;

/** A new person. `primary` is the service name, `addons` are add-on names. */
export function newPerson(primary = '', addons = []) {
  sequence += 1;
  return { key: `person-${sequence}`, primary, addons: [...addons] };
}

export const activeServices = (services = []) => (services || []).filter(s => s && s.is_active !== false);

export const activeAddons = (addons = []) => (addons || []).filter(a => a && a.is_active !== false);

/** Add-ons that may be taken with a service: unconfigured means available for all. */
export function addonsForService(addonCatalogue, service) {
  const list = activeAddons(addonCatalogue);
  if (!service) return list;
  const compatible = Array.isArray(service.compatible_addons) ? service.compatible_addons : null;
  if (compatible && compatible.length > 0) return list.filter(a => compatible.includes(a.id));
  return list.filter(a => !Array.isArray(a.compatible_services) || a.compatible_services.length === 0 || a.compatible_services.includes(service.id));
}

const normalise = value => String(value == null ? '' : value).trim().toLowerCase();
const byName = (list, name) => (list || []).find(x => normalise(x?.name) === normalise(name)) || null;

export const serviceByName = (services, name) => byName(activeServices(services), name);
export const addonByName = (addons, name) => byName(activeAddons(addons), name);

export const priceOfService = (services, name) => Number(serviceByName(services, name)?.price) || 0;
export const minsOfService = (services, name) => Number(serviceByName(services, name)?.duration_mins) || 0;
export const priceOfAddon = (addons, name) => Number(addonByName(addons, name)?.price_adjustment) || 0;
export const minsOfAddon = (addons, name) => Number(addonByName(addons, name)?.duration_adjustment) || 0;

const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

/** One person's own price and time, from the catalogue. */
export function pricePerson(person, services, addons) {
  const addonNames = (person?.addons || []).filter(Boolean);
  const servicePrice = priceOfService(services, person?.primary);
  const serviceMins = minsOfService(services, person?.primary);
  const addonPrice = addonNames.reduce((sum, a) => sum + priceOfAddon(addons, a), 0);
  const addonMins = addonNames.reduce((sum, a) => sum + minsOfAddon(addons, a), 0);
  return {
    servicePrice, serviceMins, addonPrice, addonMins,
    price: round2(servicePrice + addonPrice),
    mins: serviceMins + addonMins,
  };
}

/**
 * Everything the form and its summary need: the people that will be saved, the
 * service and add-on time kept apart, and the group discount for that many people.
 */
export function summarisePeople(people, services, addons, settings) {
  const rows = (people || [])
    .filter(p => p && p.primary)
    .map(p => ({ ...p, ...pricePerson(p, services, addons) }));

  const peopleCount = rows.length;
  const serviceMins = rows.reduce((sum, r) => sum + r.serviceMins, 0);
  const addonMins = rows.reduce((sum, r) => sum + r.addonMins, 0);
  const subtotal = round2(rows.reduce((sum, r) => sum + r.price, 0));
  const tier = getApplicableTier(peopleCount, settings);
  const discount = round2(computeGroupDiscount(peopleCount, subtotal, settings));
  const maxPeople = getMaxGroupBookingPeople(settings);

  return {
    rows,
    peopleCount,
    serviceMins,
    addonMins,
    durationMins: serviceMins + addonMins,
    subtotal,
    tier,
    discount,
    total: round2(Math.max(0, subtotal - discount)),
    maxPeople,
    overMax: peopleCount > maxPeople,
  };
}

/** Services chosen so far, with how many people are booked for each. */
export function quantityGroups(people) {
  const groups = [];
  for (const person of people || []) {
    if (!person?.primary) continue;
    const found = groups.find(g => g.name === person.primary);
    if (found) found.count += 1;
    else groups.push({ name: person.primary, count: 1 });
  }
  return groups;
}

/** One more person on that service. Add-ons belong to a person, so none are copied. */
export const addUnit = (people, serviceName) => [...(people || []), newPerson(serviceName)];

/** Removes the last person booked for that service, together with their add-ons. */
export function removeUnit(people, serviceName) {
  const list = [...(people || [])];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.primary === serviceName) {
      list.splice(i, 1);
      return list;
    }
  }
  return list;
}

/** The people sent to the server: a primary service each, plus their add-ons. */
export const participantsOf = people => (people || [])
  .filter(p => p?.primary)
  .map(p => ({ primary_service: p.primary, addons: [...(p.addons || [])] }));