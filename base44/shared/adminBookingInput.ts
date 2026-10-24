/**
 * Input rules for a booking an administrator (or a barber) creates from the
 * calendar, the Clients page or the workflow board.
 *
 * It exists because the public form's validator is deliberately strict about
 * things a person at a desk is not: a verified Australian mobile, a mandatory
 * email, a picked address with coordinates. Admin input is looser on contact
 * details, and tighter on one thing the browser must never decide: money.
 *
 * What the browser MAY send is a choice (service names and how many people), never
 * a number. `price`, `duration_mins`, `people_count`, discount, coverage tier and
 * zone are not read from the body at all; publicBookingCreate works them out.
 */
import { sanitizeString, validateEmail } from './publicBookingValidators.ts';
import { weekdayNameOf } from './bookingWindow.ts';
import { decimalToLabel } from './provisionalPlacement.ts';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PEOPLE_EXPANDED = 20;

export interface AdminInputResult {
  valid: boolean;
  errors: string[];
  sanitized: Record<string, any>;
}

const dayAndDate = (body: any, errors: string[]) => {
  const requested_date = DATE.test(String(body?.requested_date || '')) ? String(body.requested_date) : null;
  if (body?.requested_date && !requested_date) errors.push('The date is not valid.');
  // The weekday always follows the date when there is one, so the two can never disagree.
  const day = requested_date ? weekdayNameOf(requested_date) : sanitizeString(body?.day, 20);
  if (!DAYS.includes(day)) errors.push('Pick a day for this booking.');
  return { day, requested_date };
};

/** A Block Time row. Mirrors the shape BlockTimeModal always wrote. */
export function sanitizeAdminBlock(body: any): AdminInputResult {
  const errors: string[] = [];
  const { day, requested_date } = dayAndDate(body, errors);
  const reason = sanitizeString(body?.reason, 60);
  if (!reason) errors.push('A reason is required.');
  const start = Number(body?.start);
  const end = Number(body?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 24 || end <= start) {
    errors.push('End time must be after start time.');
  }
  const notes = sanitizeString(body?.notes, 500);
  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length ? {} : {
      client_name: `[BLOCK] ${reason}`,
      phone: 'BLOCK',
      day,
      requested_date,
      availability_window: `${decimalToLabel(start)}–${decimalToLabel(end)}`,
      assigned_time: decimalToLabel(start),
      services: [reason],
      ...(notes ? { notes } : {}),
      status: 'confirmed',
      duration_mins: Math.round((end - start) * 60),
      price: 0,
    },
  };
}

/** A booking or request. Services arrive as `[{ name, qty }]`: a choice, never a price. */
export function sanitizeAdminBooking(body: any): AdminInputResult {
  const errors: string[] = [];

  const client_name = sanitizeString(body?.client_name, 100);
  if (client_name.length < 2) errors.push('Client name is required.');

  const phone = sanitizeString(body?.phone, 30);
  if (phone.replace(/\D/g, '').length < 8) errors.push('A valid phone number is required.');

  const email = sanitizeString(body?.email, 200);
  if (email && !validateEmail(email)) errors.push('That email address is not valid.');

  const { day, requested_date } = dayAndDate(body, errors);

  // Coordinates are used only when the address was picked from the suggestions.
  const lat = Number(body?.address_lat);
  const lng = Number(body?.address_lng);
  const hasCoords = body?.address_lat != null && body?.address_lng != null
    && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  // People first: one participant per person, each carrying their own add-ons. This is
  // the structure a manual booking is written from, so an add-on can never be counted
  // as another person, and two people may share the same service.
  const participants: { primary_service: string; addons: string[] }[] = [];
  for (const raw of (Array.isArray(body?.participants) ? body.participants : [])) {
    const primary = sanitizeString(raw?.primary_service, 100);
    const addons = (Array.isArray(raw?.addons) ? raw.addons : [])
      .map((a: any) => sanitizeString(a, 100))
      .filter(Boolean);
    if (!primary && addons.length === 0) continue;
    if (!primary) { errors.push('Every person needs a main service.'); continue; }
    participants.push({ primary_service: primary, addons });
  }

  // Callers that send a flat list of services with quantities still work: each unit
  // is one person. Ignored when participants were given, so nothing is counted twice.
  const service_items: { name: string; qty: number }[] = [];
  for (const raw of (Array.isArray(body?.service_items) ? body.service_items : [])) {
    const name = sanitizeString(raw?.name, 100);
    const qty = Math.floor(Number(raw?.qty ?? 1));
    if (!name) continue;
    if (!Number.isFinite(qty) || qty < 1) { errors.push('Service quantities must be at least 1.'); continue; }
    service_items.push({ name, qty });
    if (participants.length === 0) {
      for (let i = 0; i < qty; i += 1) participants.push({ primary_service: name, addons: [] });
    }
  }
  if (participants.length > MAX_PEOPLE_EXPANDED) errors.push('Too many people in one booking.');

  const notes = sanitizeString(body?.notes, 2000);
  const week_of = sanitizeString(body?.week_of, 20);

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length ? {} : {
      client_name, phone, day,
      ...(email ? { email } : {}),
      ...(sanitizeString(body?.address, 300) ? { address: sanitizeString(body?.address, 300) } : {}),
      ...(hasCoords ? { address_lat: lat, address_lng: lng } : {}),
      ...(sanitizeString(body?.address_postcode, 10) ? { address_postcode: sanitizeString(body?.address_postcode, 10) } : {}),
      ...(sanitizeString(body?.address_suburb, 100) ? { address_suburb: sanitizeString(body?.address_suburb, 100) } : {}),
      ...(sanitizeString(body?.address_state, 20) ? { address_state: sanitizeString(body?.address_state, 20) } : {}),
      ...(sanitizeString(body?.address_place_id, 200) ? { address_place_id: sanitizeString(body?.address_place_id, 200) } : {}),
      ...(requested_date ? { requested_date } : {}),
      ...(sanitizeString(body?.availability_window, 50) ? { availability_window: sanitizeString(body?.availability_window, 50) } : {}),
      ...(notes ? { notes } : {}),
      ...(week_of ? { week_of } : {}),
      service_items,
      participants,
      status: 'pending',
      booking_source: 'Manual Booking',
    },
  };
}