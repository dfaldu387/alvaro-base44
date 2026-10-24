import { normaliseAuPhone } from './auPhone.ts';
import { isBlockRow } from './routeFingerprint.ts';
import { validateAuPhone, validateEmail } from './publicBookingValidators.ts';
import { resolveBookingLocation } from './bookingLocation.ts';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS } from './groupPricing.ts';
import { readSettingsList } from './settingsStore.ts';
import { mapboxGeocodeSearch } from './mapboxGeocoding.ts';
import { findValidSlots } from './slotSearch.ts';
import { revalidatePlacement } from './placementRevalidate.ts';
import { createPublicBooking } from './publicBookingCreate.ts';
import { windowLabel, type Constraint } from './assistantConstraint.ts';
import type { BookingDeps, StandIn, StandInResult } from './assistantBooking.ts';

/**
 * The live wiring for the assistant's booking conversations. Every method is a thin
 * wrapper over a shared module the rest of the system already uses:
 *
 *   search      -> slotSearch.findValidSlots   (Route Flow's candidates, validator, travel, scoring)
 *   revalidate  -> placementRevalidate         (what applyManualPlacement checks before it saves)
 *   create      -> publicBookingCreate         (the one booking creator, assistant option)
 *
 * Imported only by the inbound-SMS webhook; the flow takes it as an injected dependency.
 */

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (ymd: string) => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hasPoint = (b: any) => typeof b?.address_lat === 'number' && typeof b?.address_lng === 'number';

/** The client's most recent real booking that says what they usually have done. */
async function lastBooking(admin: any, client: any) {
  const rows = asList(await admin.entities.BookingRequest.filter({ client_id: client.id }, '-created_date', 15));
  return rows.find((b: any) => b.is_test !== true && !isBlockRow(b)
    && ((Array.isArray(b.participants) && b.participants.length) || (Array.isArray(b.services) && b.services.length))) || null;
}

const placeOf = (b: any) => ({
  address: b.address, lat: b.address_lat, lng: b.address_lng, postcode: b.address_postcode || '',
  suburb: b.address_suburb || '', state: b.address_state || '', place_id: b.address_place_id || '',
});

async function loadStandIn(admin: any, client: any, constraint: Constraint): Promise<StandInResult> {
  const last = await lastBooking(admin, client);
  if (!last) return { ok: false, code: 'no_history', reason: 'This client has no previous booking to build a new one from.' };

  // The client's CURRENT address on record wins; the last booking's address is used only when
  // there is no current address at all (someone who has moved must not be routed from the old one).
  const current = String(client.address || '').trim();
  let place: ReturnType<typeof placeOf>;
  let address_source: StandIn['address_source'];
  if (current.length >= 5) {
    address_source = 'client_record';
    if (norm(current) === norm(last.address) && hasPoint(last)) {
      place = placeOf(last);
    } else {
      const query = [current, client.suburb, client.postcode].filter(Boolean).join(', ');
      const proximity = hasPoint(last) ? { lat: last.address_lat, lng: last.address_lng } : null;
      const hit: any = asList((await mapboxGeocodeSearch(query, proximity))?.suggestions)[0];
      if (!hit || typeof hit.lat !== 'number' || typeof hit.lng !== 'number') {
        return { ok: false, code: 'error', reason: 'The address on the client record could not be located, so no times were worked out.' };
      }
      place = { address: hit.formatted_address || current, lat: hit.lat, lng: hit.lng, postcode: hit.postcode || '', suburb: hit.suburb || '', state: hit.state || '', place_id: hit.place_id || '' };
    }
  } else if (String(last.address || '').trim() && hasPoint(last)) {
    address_source = 'last_booking';
    place = placeOf(last);
  } else {
    return { ok: false, code: 'no_address', reason: 'There is no address on record for this client.' };
  }

  const phone = String(client.phone || last.phone || '').trim();
  const email = String(client.email || last.email || '').trim();
  const name = String(client.client_name || last.client_name || '').trim();
  if (!normaliseAuPhone(phone) || !validateAuPhone(phone) || !validateEmail(email) || name.length < 2) {
    return { ok: false, code: 'no_contact', reason: 'The client record is missing a valid mobile, email or name needed to make a booking.' };
  }

  // Services: what they usually have. A service named in the message replaces it only for a single-person booking.
  let participants = (Array.isArray(last.participants) && last.participants.length)
    ? last.participants.map((p: any) => ({ primary_service: p.primary_service, addons: p.addons || [] }))
    : (last.services || []).slice(0, 1).map((s: string) => ({ primary_service: s, addons: [] }));
  if (constraint.service_hint && participants.length === 1) {
    const services = asList(await admin.entities.Service.filter({ is_active: true }, 'sort_order', 50));
    const hint = norm(constraint.service_hint);
    const match = services.find((s: any) => norm(s.name) === hint)
      || services.find((s: any) => hint.length >= 4 && norm(s.name).includes(hint));
    if (match) participants = [{ primary_service: match.name, addons: [] }];
  }

  const day = dayName(constraint.date);
  const [areas, settings] = await Promise.all([
    admin.entities.ServiceArea.list('sort_order', 200),
    readSettingsList(admin, 'GroupDiscountSettings'),
  ]);
  const settingsList = asList(settings);
  const settingsRecord = settingsList.find((s: any) => !s.team_member_id) || settingsList[0] || DEFAULT_GROUP_DISCOUNT_SETTINGS;
  const location = resolveBookingLocation({
    latitude: place.lat, longitude: place.lng, activeAreas: asList(areas).filter((a: any) => a.active !== false), settings: settingsRecord, day,
  });
  if (!location.ok) return { ok: false, code: 'no_coverage', reason: `The client's address is not bookable by text (${location.error}).` };

  const services = participants.flatMap((p: any) => [p.primary_service, ...(p.addons || [])]);
  const body = {
    client_name: name, phone, email, address: place.address, address_lat: place.lat, address_lng: place.lng,
    address_postcode: place.postcode, address_suburb: place.suburb, address_state: place.state, address_place_id: place.place_id,
    day, requested_date: constraint.date, services, participants,
    availability_window: windowLabel(constraint), time_blocks: [], messaging_consent: last.messaging_consent === true,
  };
  const booking = {
    ...last, id: undefined, client_id: client.id, client_name: name, phone, email,
    address: place.address, address_lat: place.lat, address_lng: place.lng, address_suburb: place.suburb,
    day, requested_date: constraint.date, availability_window: windowLabel(constraint), participants, services,
    assigned_time: null, schedule_status: 'unscheduled', status: 'pending', availability_override: false, is_test: false, protection_hold: false,
    team_member_id: location.team_member_id, team_member_name: location.team_member_name,
  };
  return { ok: true, booking, body, address_source };
}

export const liveBookingDeps: BookingDeps = {
  loadStandIn,

  async search(admin, standIn, constraint) {
    const found = await findValidSlots(admin, {
      booking: standIn.booking, date: constraint.date, barberId: standIn.booking.team_member_id || null, limit: 12, minGapMinutes: 30,
    });
    return {
      slots: found.suggestions.map((s: any) => ({ label: s.label, start_decimal: s.start })),
      duration_minutes: found.ctx.service_minutes,
      reason: found.reason,
    };
  },

  async revalidate(admin, standIn, date, start) {
    const check = await revalidatePlacement(admin, {
      booking: standIn.booking, date, barberId: standIn.booking.team_member_id || null, start, options: { source: 'route_flow' },
    });
    if (check.stage === 'ok') return { ok: true, stage: 'ok', label: check.result.proposed_start };
    const codes = check.stage === 'raced' ? check.raceCodes : (check.result.codes || []);
    return { ok: false, stage: check.stage, reason: codes.join(', ') };
  },

  async create(admin, standIn, assistant, token) {
    // No real request: the assistant has no connection fingerprint, so these never share one rate-limit bucket.
    const out = await createPublicBooking(admin, {
      body: { ...standIn.body, submission_token: token }, req: new Request('https://assistant.invalid/'), assistant,
    });
    if (out.body?.success === true && out.body.id) return { ok: true, id: out.body.id };
    if (out.body?.refused === 'held') return { ok: false, reason: `held by booking protection: ${(out.body.reasons || [])[0] || 'needs a person to look'}` };
    return { ok: false, reason: String(out.body?.error || 'the booking could not be saved') };
  },

  async searchExisting(admin, booking, constraint) {
    const date = constraint?.date || booking.requested_date;
    const stand = constraint ? { ...booking, availability_window: windowLabel(constraint) } : booking;
    const found = await findValidSlots(admin, { booking: stand, date, barberId: booking.team_member_id || null, limit: 12, minGapMinutes: 30 });
    return { date, slots: found.suggestions.map((s: any) => ({ label: s.label, start_decimal: s.start })), duration_minutes: found.ctx.service_minutes };
  },
};