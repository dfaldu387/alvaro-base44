/**
 * appointmentTiming — the calendar's copy of the ONE timing rule, mirroring
 * base44/shared/appointmentTiming.ts exactly.
 *
 * Occupancy = service duration + the buffer CONFIGURED on the service. There is
 * no hidden default buffer: a service with no buffer configured occupies exactly
 * its service time. Travel is not occupancy — it is a separate constraint between
 * two appointments, derived once from the real road time.
 *
 * The backend validator stays authoritative for every decision (Route Flow,
 * manual drags, reshuffles). This module only makes the calendar display and
 * preview the same numbers the backend will enforce.
 */

/** The scheduling increment — appointments start on these marks and nowhere else. */
export const STEP_MINUTES = 5;

/** Round a decimal hour UP to the scheduling increment (10:03 → 10:05). */
export function snapUpToStep(dec, stepMins = STEP_MINUTES) {
  // Whole minutes, so floating-point drift cannot add a phantom step.
  return Math.round(Math.ceil(dec * 60 / (stepMins || STEP_MINUTES) - 1e-6) * (stepMins || STEP_MINUTES)) / 60;
}

/** A configured buffer of 0 means exactly that: no time is added. */
export function normaliseBufferMinutes(raw) {
  const n = Number(raw);
  return isFinite(n) && n > 0 ? n : 0;
}

/** What the calendar holds for one appointment: service + configured buffer. */
export function occupancyMinutes(serviceMinutes, bufferMinutes) {
  const service = Number(serviceMinutes) || 0;
  if (!(service > 0)) return 0;
  return service + normaliseBufferMinutes(bufferMinutes);
}

function nameKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/** "2x Haircut" → "haircut": a saved booking name carries its quantity. */
function serviceNameKey(value) {
  return nameKey(String(value == null ? '' : value).replace(/^\s*\d+\s*x\s*/i, ''));
}

/** The services and add-ons a booking record is made of. */
function itemNames(booking) {
  const participants = Array.isArray(booking?.participants) ? booking.participants : [];
  if (participants.length > 0) {
    const primary = [];
    const addons = [];
    for (const p of participants) {
      if (nameKey(p?.primary_service)) primary.push(serviceNameKey(p.primary_service));
      for (const a of (p?.addons || [])) if (nameKey(a)) addons.push(serviceNameKey(a));
    }
    return { primary, addons };
  }
  return { primary: (booking?.services || []).map(serviceNameKey).filter(Boolean), addons: [] };
}

/** Live services + add-ons, indexed by name for buffer lookups. */
export async function loadTimingCatalogue(base44) {
  const [serviceRows, addonRows] = await Promise.all([
    base44.entities.Service.list('sort_order', 200).catch(() => []),
    base44.entities.AddOn.list('sort_order', 200).catch(() => []),
  ]);
  const services = serviceRows || [];
  const addons = addonRows || [];
  const serviceByName = new Map();
  const addonByName = new Map();
  for (const s of services) if (s.is_active !== false) serviceByName.set(serviceNameKey(s.name), s);
  for (const a of addons) if (a.is_active !== false) addonByName.set(serviceNameKey(a.name), a);
  return { services, addons, serviceByName, addonByName };
}

/**
 * The buffer CONFIGURED on a booking's service(s) — one buffer per booking, since
 * group participants are served one after another, never in parallel. Add-ons add
 * service time only. No catalogue, or an unknown service, resolves to 0 rather
 * than to an invented default.
 */
export function bufferMinutesFor(booking, catalogue) {
  if (!booking || !catalogue) return 0;
  const { primary } = itemNames(booking);
  let buffer = 0;
  for (const name of primary) {
    buffer = Math.max(buffer, normaliseBufferMinutes(catalogue.serviceByName?.get(name)?.buffer_mins));
  }
  return buffer;
}

/** Service minutes this record was sized with (falls back to configured time). */
export function serviceMinutesFor(booking, catalogue) {
  const stored = Number(booking?.duration_mins) || 0;
  if (stored > 0) return stored;
  if (!catalogue) return 0;
  const { primary, addons } = itemNames(booking);
  let minutes = 0;
  for (const name of primary) minutes += Number(catalogue.serviceByName?.get(name)?.duration_mins) || 0;
  for (const name of addons) minutes += Number(catalogue.addonByName?.get(name)?.duration_adjustment) || 0;
  return minutes;
}