/**
 * Route Flow — Category 1: Booking Validity & Hard Constraints.
 *
 * The single, backend-authoritative implementation of "is this placement
 * actually possible?". Shared by:
 *   - Route Flow automatic placement       (routeFlowAutoPlace)
 *   - Route Flow reshuffle evaluation      (routeFlowEvaluateReshuffle)
 *   - Manual calendar scheduling + drag    (validateBookingPlacement → Schedule page)
 *   - Admin debugging / testing            (Route Flow → Placement → Validate)
 *
 * Rules of this module:
 *   - It NEVER writes. Callers must re-validate immediately before writing,
 *     because a result only describes the schedule as it stood when evaluated.
 *   - It never changes the customer's submitted availability and never creates
 *     an availability override. Only an explicit admin "Schedule Anyway"
 *     (options.admin_override_availability) may bypass customer availability.
 *   - The Booking Window (BookingRules.minimum_notice_hours /
 *     maximum_booking_days) is enforced here for every source — public booking,
 *     Route Flow, reshuffle and the manual calendar — so the same input always
 *     produces the same verdict. Automation can never override it; only an
 *     explicit admin override (options.admin_override_window) may, and the
 *     caller records the override reason.
 *   - Hard constraints only. No scoring, weighting, displacement or
 *     optimisation lives here — Route Flow must never optimise an invalid
 *     placement.
 *   - Deterministic for identical inputs and unchanged travel estimates.
 */

import { parseWindow, parseTimeStr, decimalToLabel } from './provisionalPlacement.ts';
import { calculateServiceCoverage, validateCoverageConfig } from './serviceCoverage.ts';
import { mapboxDriveMatrix, toTravelMins, MAX_MATRIX_POINTS } from './mapboxTravel.ts';
import {
  STEP_MINUTES,
  snapUpToStep,
  occupancyMinutes,
  resolveBookingTiming,
  getEarliestFeasibleNextStart,
} from './appointmentTiming.ts';
export { snapUpToStep };
import {
  DEFAULT_GROUP_DISCOUNT_SETTINGS,
  getServiceCentre,
  getExtendedRadiusKm,
  getMaxServiceRadiusKm,
  DEFAULT_MAX_SERVICE_RADIUS_KM,
} from './groupPricing.ts';
import {
  DEFAULT_BOOKING_WINDOW,
  BOOKING_WINDOW_CODES,
  bookingWindowVerdict,
  normaliseBookingWindow,
} from './bookingWindow.ts';

// ── Constants ────────────────────────────────────────────────────────────────

/** The scheduling increment — one definition, in the shared timing module. */
export const SNAP_MINUTES = STEP_MINUTES;
/** Existing public-booking minimum availability window (AvailabilityStep: minWindowHrs = 1). */
export const MIN_WINDOW_MINUTES = 60;
export const SYDNEY_TZ = 'Australia/Sydney';
/** Guard rail for nonsense durations. */
export const MAX_SERVICE_MINUTES = 12 * 60;

export const VALIDATION_CODES = {
  MISSING_REQUIRED_DATA: 'MISSING_REQUIRED_DATA',
  INVALID_SERVICE_DURATION: 'INVALID_SERVICE_DURATION',
  OUTSIDE_CUSTOMER_AVAILABILITY: 'OUTSIDE_CUSTOMER_AVAILABILITY',
  OUTSIDE_WORKING_HOURS: 'OUTSIDE_WORKING_HOURS',
  BOOKING_TOO_SOON: BOOKING_WINDOW_CODES.TOO_SOON,
  BOOKING_TOO_FAR_AHEAD: BOOKING_WINDOW_CODES.TOO_FAR_AHEAD,
  APPOINTMENT_OVERLAP: 'APPOINTMENT_OVERLAP',
  PROTECTED_APPOINTMENT: 'PROTECTED_APPOINTMENT',
  BREAK_CONFLICT: 'BREAK_CONFLICT',
  INSUFFICIENT_TRAVEL: 'INSUFFICIENT_TRAVEL',
  TRAVEL_UNVERIFIED: 'TRAVEL_UNVERIFIED',
  COVERAGE_RESTRICTION: 'COVERAGE_RESTRICTION',
};

export const CHECK_LABELS = {
  MISSING_REQUIRED_DATA: 'Scheduling information complete',
  INVALID_SERVICE_DURATION: 'Service duration valid',
  OUTSIDE_CUSTOMER_AVAILABILITY: 'Inside customer availability',
  OUTSIDE_WORKING_HOURS: 'Inside barber working hours',
  BOOKING_TOO_SOON: 'Outside the minimum notice period',
  BOOKING_TOO_FAR_AHEAD: 'Inside the booking horizon',
  APPOINTMENT_OVERLAP: 'No appointment overlap',
  PROTECTED_APPOINTMENT: 'No protected appointment affected',
  BREAK_CONFLICT: 'No break or blocked time conflict',
  INSUFFICIENT_TRAVEL: 'Sufficient travel time',
  TRAVEL_UNVERIFIED: 'Travel time verified',
  COVERAGE_RESTRICTION: 'Inside service coverage',
};

/** Days a barber is treated as unavailable when no configuration exists. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Statuses that mean the record never occupied real time — ignored for capacity. */
export const DEAD_STATUSES = ['declined', 'could_not_fit', 'no_show'];

// ── Time helpers (Sydney, DST-safe) ──────────────────────────────────────────

/** Offset of `tz` from UTC, in minutes, at the given instant. */
export function tzOffsetMinutes(ms: number, tz: string = SYDNEY_TZ): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(ms));
  const p: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUTC = Date.UTC(p.year, (p.month || 1) - 1, p.day || 1, (p.hour || 0) % 24, p.minute || 0, p.second || 0);
  return Math.round((asUTC - ms) / 60000);
}

/** Wall-clock date + decimal hour in Sydney → epoch ms. Correct across DST. */
export function zonedEpoch(dateStr: string, decimalHour: number, tz: string = SYDNEY_TZ): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !isFinite(decimalHour)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const hh = Math.floor(decimalHour);
  const mm = Math.round((decimalHour - hh) * 60);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let offset = tzOffsetMinutes(naive, tz);
  let ts = naive - offset * 60000;
  offset = tzOffsetMinutes(ts, tz);
  ts = naive - offset * 60000;
  return ts;
}

/** Current Sydney wall clock — the timezone every booking decision uses. */
export function sydneyNow(now: number = Date.now()): { epoch: number; date: string; decimal: number } {
  const offset = tzOffsetMinutes(now, SYDNEY_TZ);
  const local = new Date(now + offset * 60000);
  return {
    epoch: now,
    date: local.toISOString().slice(0, 10),
    decimal: local.getUTCHours() + local.getUTCMinutes() / 60,
  };
}

export function weekdayName(dateStr: string): string {
  const ts = zonedEpoch(dateStr, 12);
  if (ts == null) return '';
  const local = new Date(ts + tzOffsetMinutes(ts) * 60000);
  return WEEKDAYS[local.getUTCDay()] || '';
}

/** "11:00am" / "14:30" / 14.5 → decimal hour. */
export function parseStartTime(value: unknown): number {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return isFinite(value) ? value : NaN;
  const str = String(value).trim();
  if (/^\d{1,2}(\.\d+)?$/.test(str)) return Number(str);
  return parseTimeStr(str);
}

// snapUpToStep is imported from appointmentTiming and re-exported above, so the
// scheduling increment has exactly one definition.

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - 1e-9 && aEnd > bStart + 1e-9;
}

function nameKey(v: unknown): string {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface OccupiedBlock {
  id: string;
  label: string;
  kind: 'appointment' | 'block';
  /** Lifecycle protection state — never confused with Completed/Cancelled. */
  protection: 'provisional' | 'locked' | 'confirmed' | 'completed' | 'none';
  start: number;          // decimal hour
  service_minutes: number;
  buffer_minutes: number; // the buffer CONFIGURED on this appointment's service
  end: number;            // decimal hour (service end)
  occupied_end: number;   // decimal hour (service + configured buffer)
  team_member_id: string | null;
  is_test: boolean;
  point: { lat: number; lng: number } | null;
  address: string;
}

/**
 * The assigned barber's saved default start location — the origin of the FIRST
 * leg of their day. `configured` is true only when the profile carries usable
 * coordinates, so a saved address with no coordinates is never mistaken for
 * "zero travel".
 */
export interface StartLocation {
  configured: boolean;
  address: string;
  point: { lat: number; lng: number } | null;
}

export interface WorkWindow {
  status: 'open' | 'closed';
  source: 'special_hours' | 'working_hours' | 'service_zone' | 'default';
  label: string | null;
  normal: { start: number; end: number } | null;
  extended: { start: number; end: number } | null;
}

export interface PlacementContext {
  errors: string[];
  booking: any;
  is_test: boolean;
  date: string;
  day: string;
  barber_id: string | null;
  barber_name: string;
  service_minutes: number;
  configured_service_minutes: number;
  buffer_minutes: number;
  calendar_minutes: number;
  window_raw: string;
  window: { start: number; end: number } | null;
  window_flexible: boolean;
  work: WorkWindow;
  occupied: OccupiedBlock[];
  drive_legs: { from: string; to: string; duration_mins: number | null }[];
  coverage: any;
  coverage_error: string | null;
  /** Booking window in force for this placement — owned by Booking Rules. */
  booking_window: { minimum_notice_hours: number; maximum_booking_days: number };
  settings_warnings: string[];
  /** Assigned barber's saved start location (origin of the day's first leg). */
  start_location: StartLocation | null;
}

export interface TravelIndex {
  available: boolean;
  reason: string | null;
  /** Ceil-to-5 minute road travel between two keys ('PROPOSED', 'START' or an appointment id). */
  mins: (fromKey: string, toKey: string) => number | null;
  /**
   * Present only when the caller asked for the barber's start location to be
   * part of the journey (Route Flow). Manual placement omits it and keeps
   * exactly its previous legs-only behaviour.
   */
  start?: StartLocation;
}

export interface PlacementResult {
  valid: boolean;
  barber_id: string | null;
  barber_name: string;
  date: string;
  day: string;
  proposed_start: string;
  proposed_end: string;
  proposed_start_decimal: number;
  proposed_end_decimal: number;
  calendar_minutes: number;
  service_minutes: number;
  buffer_minutes: number;
  availability: any;
  working_hours: any;
  coverage: any;
  capacity: any;
  travel: any;
  /** service end → buffer end → required travel → earliest legal next start. */
  timing: any;
  booking_window: any;
  checks: { code: string; label: string; passed: boolean; message: string; details?: any }[];
  violations: { code: string; message: string; details?: any }[];
  warnings: { code: string; message: string }[];
  codes: string[];
  source: string;
  evaluated_at: string;
}

// ── Context loading ──────────────────────────────────────────────────────────

/**
 * Resolves the authoritative working window for a date.
 * Order: Special Hours (date) → Normal Working Hours (weekday) → Service Zone
 * day hours → built-in default. Extended Hours are recognised but never used
 * automatically by Route Flow.
 */
export function resolveWorkWindow(member: any, zoneDay: any, dateStr: string, day: string): WorkWindow {
  const special = (member?.special_hours || []).find((s: any) => s.date === dateStr);
  if (special) {
    if (special.is_open === false) {
      return { status: 'closed', source: 'special_hours', label: special.label || 'Closed', normal: null, extended: null };
    }
    const start = typeof special.open_time === 'number' ? special.open_time : 9;
    const end = typeof special.close_time === 'number' ? special.close_time : 17;
    return {
      status: 'open',
      source: 'special_hours',
      label: special.label || null,
      normal: { start, end },
      extended: buildExtended(member, start, end),
    };
  }

  const dayHours = (member?.working_hours || []).find((h: any) => h.day_of_week === day);
  if (dayHours) {
    if (dayHours.is_open === false) {
      return { status: 'closed', source: 'working_hours', label: null, normal: null, extended: null };
    }
    const start = typeof dayHours.open_time === 'number' ? dayHours.open_time : 9;
    const end = typeof dayHours.close_time === 'number' ? dayHours.close_time : 17;
    return {
      status: 'open',
      source: 'working_hours',
      label: null,
      normal: { start, end },
      extended: buildExtended(member, start, end),
    };
  }

  if (zoneDay) {
    const start = typeof zoneDay.open_time === 'number' ? zoneDay.open_time : 9;
    const end = typeof zoneDay.close_time === 'number' ? zoneDay.close_time : 17;
    return { status: 'open', source: 'service_zone', label: null, normal: { start, end }, extended: null };
  }

  if (member) {
    return { status: 'open', source: 'default', label: null, normal: { start: 9, end: 17 }, extended: null };
  }

  return { status: 'open', source: 'default', label: null, normal: { start: 9, end: 17 }, extended: null };
}

function buildExtended(member: any, start: number, end: number): { start: number; end: number } | null {
  if (!member) return null;
  const early = member.allow_early_extension === false ? 0 : (member.early_extension_minutes || 0);
  const late = member.allow_late_extension === false ? 0 : (member.late_extension_minutes || 0);
  if (early <= 0 && late <= 0) return null;
  return { start: Math.max(0, start - early / 60), end: Math.min(24, end + late / 60) };
}

/**
 * Loads everything a validity decision needs for one proposed placement.
 * Read-only. Takes whichever client the caller must use (service role for
 * automation, the caller's client for admin/manual validation).
 */
export async function loadPlacementContext(
  base44: any,
  { booking, date, barberId }: { booking: any; date?: string; barberId?: string | null },
): Promise<PlacementContext> {
  const ctx: PlacementContext = {
    errors: [],
    booking: booking || null,
    is_test: booking?.is_test === true,
    date: '',
    day: '',
    barber_id: null,
    barber_name: '',
    service_minutes: 0,
    configured_service_minutes: 0,
    // Pre-load value only: the real buffer is whatever the service is configured
    // with (resolveBookingTiming), never a default.
    buffer_minutes: 0,
    calendar_minutes: 0,
    window_raw: '',
    window: null,
    window_flexible: false,
    work: { status: 'open', source: 'default', label: null, normal: { start: 9, end: 17 }, extended: null },
    occupied: [],
    drive_legs: [],
    coverage: null,
    coverage_error: null,
    booking_window: DEFAULT_BOOKING_WINDOW,
    settings_warnings: [],
    start_location: null,
  };

  if (!booking) {
    ctx.errors.push('Booking request not found.');
    return ctx;
  }

  const dateStr = String(date || booking.requested_date || '').trim();
  ctx.date = dateStr;
  ctx.day = booking.day || weekdayName(dateStr);
  if (!dateStr) ctx.errors.push('No appointment date on the booking request.');

  // ── Authoritative configuration ───────────────────────────────────────────
  const [serviceRows, addonRows, settingsRows, zoneRows, connections, bookingRuleRows] = await Promise.all([
    base44.entities.Service.list('sort_order', 200).catch(() => []),
    base44.entities.AddOn.list('sort_order', 200).catch(() => []),
    base44.entities.GroupDiscountSettings.list('-created_date', 1).catch(() => []),
    base44.entities.ServiceArea.list('sort_order', 100).catch(() => []),
    dateStr
      ? base44.entities.RouteConnection.filter({ date: dateStr }, '-created_date', 200).catch(() => [])
      : Promise.resolve([]),
    // The Booking Window — read fresh on every evaluation so a settings change
    // applies to the very next placement, with no code change and no cache.
    base44.entities.BookingRules.list('-created_date', 1).catch(() => []),
  ]);

  const services = serviceRows || [];
  const addons = addonRows || [];
  const settings = (settingsRows || [])[0] || DEFAULT_GROUP_DISCOUNT_SETTINGS;
  const zones = (zoneRows || []).filter((z: any) => z.active !== false);

  const serviceByName = new Map<string, any>();
  for (const s of services) if (s.is_active !== false) serviceByName.set(nameKey(s.name), s);
  const addonByName = new Map<string, any>();
  for (const a of addons) if (a.is_active !== false) addonByName.set(nameKey(a.name), a);

  // ── Service + buffer duration ─────────────────────────────────────────────
  // One shared calculation (appointmentTiming): the service time the booking was
  // sized with, plus the buffer CONFIGURED on that service. There is NO hidden
  // default buffer — a service with no buffer configured occupies exactly its
  // service time, so consecutive appointments pack as tightly as the real work
  // allows. Travel is not part of this number: it is a separate constraint
  // between two appointments, and it is counted once (see evaluateTravel).
  const timing = resolveBookingTiming(booking, serviceByName, addonByName);
  ctx.configured_service_minutes = timing.configured_service_minutes;
  ctx.service_minutes = timing.service_minutes;
  ctx.buffer_minutes = timing.buffer_minutes;
  ctx.calendar_minutes = timing.occupancy_minutes;

  // ── Customer availability (never modified) ────────────────────────────────
  ctx.window_raw = String(booking.availability_window || '').trim();
  ctx.window_flexible = ctx.window_raw.toLowerCase() === 'flexible';
  ctx.window = parseWindow(ctx.window_raw);
  if (!ctx.window_flexible && !ctx.window && ctx.window_raw) {
    ctx.errors.push(`Availability window "${ctx.window_raw}" could not be read.`);
  }
  if (!ctx.window_flexible && !ctx.window_raw) {
    ctx.errors.push('No customer availability window on the booking request.');
  }
  if (ctx.window && (ctx.window.end - ctx.window.start) * 60 < MIN_WINDOW_MINUTES - 1e-6) {
    ctx.settings_warnings.push(`Customer window is shorter than the ${MIN_WINDOW_MINUTES}-minute minimum.`);
  }
  // After-hours requests carry the exact slot the customer agreed to.
  const afterHoursSlot = booking.after_hours_mode && booking.after_hours_slot
    ? parseStartTime(booking.after_hours_slot)
    : NaN;
  if (isFinite(afterHoursSlot)) {
    ctx.window = { start: afterHoursSlot, end: afterHoursSlot + ctx.calendar_minutes / 60 };
    ctx.window_flexible = false;
  }

  // ── Barber + working hours ────────────────────────────────────────────────
  const teamId = barberId || booking.team_member_id || null;
  ctx.barber_id = teamId || null;
  let member: any = null;
  if (teamId) {
    try {
      member = await base44.entities.TeamMember.get(teamId);
      ctx.barber_name = member?.name || '';
    } catch {
      ctx.settings_warnings.push('Assigned barber could not be loaded — business hours applied.');
    }
  }
  // Where this barber's day starts. Read from the assigned barber's own profile —
  // there is deliberately no business-wide start location.
  ctx.start_location = readStartLocation(member);

  let zone: any = null;
  if (booking.service_zone_id) {
    try {
      zone = await base44.entities.ServiceArea.get(booking.service_zone_id);
    } catch {
      /* optional */
    }
  }
  const zoneDay = ((zone?.service_days || [])).find((d: any) => d.enabled && d.day_of_week === ctx.day) || null;
  ctx.work = resolveWorkWindow(member, zoneDay, dateStr, ctx.day);

  // ── Occupied capacity for this exact date ─────────────────────────────────
  // Test separation: test records only ever block other test records.
  if (dateStr) {
    let rows: any[] = [];
    try {
      rows = await base44.entities.BookingRequest.filter({ requested_date: dateStr }, '-created_date', 200);
    } catch {
      ctx.errors.push('Existing appointments for this date could not be loaded.');
    }
    ctx.occupied = (rows || [])
      .filter((r: any) => r.id !== booking.id)
      .filter((r: any) => (r.is_test === true) === ctx.is_test)
      // Capacity and travel are per barber: another barber working the same date
      // does not occupy this barber's time. Unassigned legacy records still count.
      .filter((r: any) => !ctx.barber_id || !r.team_member_id || r.team_member_id === ctx.barber_id)
      .filter((r: any) => r.assigned_time && !DEAD_STATUSES.includes(r.status))
      .map((r: any) => {
        const start = parseTimeStr(r.assigned_time);
        if (isNaN(start)) return null;
        const isBlock = String(r.client_name || '').startsWith('[BLOCK]') || r.status === 'blocked';
        const serviceMins = Number(r.duration_mins) || 30;
        // Each appointment occupies its own service time + ITS OWN configured
        // buffer — never a shared default. A break has no buffer at all.
        const bufferMins = isBlock ? 0 : resolveBookingTiming(r, serviceByName, addonByName).buffer_minutes;
        let protection: OccupiedBlock['protection'] = 'none';
        if (r.schedule_status === 'provisional' || r.schedule_status === 'locked' || r.schedule_status === 'confirmed') {
          protection = r.schedule_status;
        } else if (r.status === 'completed') {
          protection = 'completed';
        }
        return {
          id: r.id,
          label: String(r.client_name || 'Appointment').replace('[BLOCK] ', ''),
          kind: isBlock ? 'block' : 'appointment',
          protection,
          start,
          service_minutes: serviceMins,
          buffer_minutes: bufferMins,
          end: start + serviceMins / 60,
          occupied_end: start + occupancyMinutes(serviceMins, bufferMins) / 60,
          team_member_id: r.team_member_id || null,
          is_test: r.is_test === true,
          point: (typeof r.address_lat === 'number' && typeof r.address_lng === 'number')
            ? { lat: r.address_lat, lng: r.address_lng }
            : null,
          address: r.address || '',
        } as OccupiedBlock;
      })
      .filter(Boolean) as OccupiedBlock[];
  }

  // Existing drive legs are travel commitments, not extra occupancy — recorded
  // here for transparency only, never added to occupied time (no double count).
  ctx.drive_legs = (connections || []).map((c: any) => ({
    from: c.from_appointment_id,
    to: c.to_appointment_id,
    duration_mins: typeof c.duration_minutes === 'number' ? c.duration_minutes : null,
  }));

  // ── Service coverage (existing backend-authoritative rules) ───────────────
  const centre = getServiceCentre(settings);
  const extendedKm = getExtendedRadiusKm(settings);
  const maxKm = getMaxServiceRadiusKm(settings) || DEFAULT_MAX_SERVICE_RADIUS_KM;
  const cfgCheck = validateCoverageConfig(centre, extendedKm, maxKm);
  if (!cfgCheck.valid) {
    ctx.coverage_error = cfgCheck.error || 'Service coverage is not configured.';
  } else if (typeof booking.address_lat !== 'number' || typeof booking.address_lng !== 'number') {
    ctx.coverage_error = 'The service address has no verified location.';
  } else {
    ctx.coverage = calculateServiceCoverage({
      latitude: booking.address_lat,
      longitude: booking.address_lng,
      activeZones: zones,
      coverageCentre: centre,
      extendedRadiusKm: extendedKm,
      maximumRadiusKm: maxKm,
    });
  }

  // ── Booking window (Booking Rules) ────────────────────────────────────────
  // One setting, applied to every source rather than a per-channel lead time:
  // public booking, Route Flow (placement and reshuffle) and the manual
  // calendar all read exactly this value.
  ctx.booking_window = normaliseBookingWindow((bookingRuleRows || [])[0]);

  return ctx;
}

/**
 * Road-travel index for a proposed address against the day's appointments.
 * One Mapbox Matrix call covers every candidate slot evaluated afterwards.
 * `available: false` means the caller must NOT approve the placement.
 */
export async function buildTravelIndex(
  ctx: PlacementContext,
  proposedPoint: { lat: number; lng: number } | null,
  options: { include_start_location?: boolean } = {},
): Promise<TravelIndex> {
  // The barber's own start location is the origin of the FIRST leg of the day.
  // It only joins the journey when the caller asks for it, so every existing
  // caller that does not (manual placement) behaves exactly as before.
  const start: StartLocation | undefined = options?.include_start_location === true
    ? (ctx.start_location || { configured: false, address: '', point: null })
    : undefined;
  const withStart = (index: TravelIndex): TravelIndex => (start ? { ...index, start } : index);
  const unavailable = (reason: string): TravelIndex => withStart({ available: false, reason, mins: () => null });

  const neighbours = ctx.occupied.filter(o => o.kind === 'appointment' && o.point);
  if (neighbours.length === 0 && !start?.point) {
    // Nothing to travel from or to — no journey is required. With a configured
    // start location the first leg still exists, so the matrix is still needed.
    return withStart({ available: true, reason: null, mins: () => 0 });
  }
  if (!proposedPoint || typeof proposedPoint.lat !== 'number' || typeof proposedPoint.lng !== 'number') {
    return unavailable('The proposed appointment address has no verified location.');
  }
  if (neighbours.length + 1 + (start?.point ? 1 : 0) > MAX_MATRIX_POINTS) {
    return unavailable('Too many appointments on this day to verify travel in one request.');
  }

  const points = [
    proposedPoint,
    ...neighbours.map(n => n.point as { lat: number; lng: number }),
    ...(start?.point ? [start.point] : []),
  ];
  const matrix = await mapboxDriveMatrix(points);
  if (!matrix.ok || !matrix.durations) {
    return unavailable(matrix.error || 'Driving estimates are unavailable.');
  }

  const indexByKey: Record<string, number> = { PROPOSED: 0 };
  neighbours.forEach((n, i) => { indexByKey[n.id] = i + 1; });
  if (start?.point) indexByKey.START = neighbours.length + 1;

  return withStart({
    available: true,
    reason: null,
    mins: (fromKey: string, toKey: string) => {
      const i = indexByKey[fromKey];
      const j = indexByKey[toKey];
      if (i == null || j == null) return null;
      const seconds = matrix.durations?.[i]?.[j];
      return toTravelMins(seconds == null ? null : seconds);
    },
  });
}

// ── Evaluation (pure, deterministic) ─────────────────────────────────────────

export interface EvaluateOptions {
  admin_override_availability?: boolean;
  /** Explicit admin "Schedule Anyway" authority over the Booking Window. */
  admin_override_window?: boolean;
  /**
   * Explicit admin authority to place a time whose travel cannot be achieved.
   * Travel stays a hard constraint for Route Flow and every automated caller;
   * only a person may take this path, and the caller records the reason.
   */
  admin_override_travel?: boolean;
  source?: 'route_flow' | 'manual';
  travel?: TravelIndex | null;
  now?: number;
  /**
   * Batch moves (a reshuffle suggestion) that the reshuffle engine validates as
   * a set — those appointments are excluded from single-placement capacity and
   * travel checks. Protected time, breaks, closures and coverage always apply.
   */
  ignore_appointment_ids?: string[];
}

/**
 * Evaluates every Category 1 hard constraint for one candidate start time.
 * Pure: no reads, no writes, identical inputs → identical result.
 */
export function evaluatePlacement(
  ctx: PlacementContext,
  startInput: number,
  options: EvaluateOptions = {},
): PlacementResult {
  const source = options.source || 'manual';
  const automated = source === 'route_flow';
  const checks: PlacementResult['checks'] = [];
  const violations: PlacementResult['violations'] = [];
  const warnings: PlacementResult['warnings'] = [];

  const check = (code: string, passed: boolean, message = '', details?: any) => {
    checks.push({ code, label: CHECK_LABELS[code] || code, passed, message, details });
    if (!passed) violations.push({ code, message, details });
  };
  const warn = (code: string, message: string) => warnings.push({ code, message });

  const rawStart = isFinite(startInput) ? startInput : NaN;
  const start = isNaN(rawStart) ? NaN : snapUpToStep(rawStart);
  const end = isNaN(start) ? NaN : start + ctx.calendar_minutes / 60;

  const base = {
    valid: false,
    barber_id: ctx.barber_id,
    barber_name: ctx.barber_name,
    date: ctx.date,
    day: ctx.day,
    proposed_start: isNaN(start) ? '' : decimalToLabel(start),
    proposed_end: isNaN(end) ? '' : decimalToLabel(end),
    proposed_start_decimal: start,
    proposed_end_decimal: end,
    calendar_minutes: ctx.calendar_minutes,
    service_minutes: ctx.service_minutes,
    buffer_minutes: ctx.buffer_minutes,
    source,
    evaluated_at: new Date().toISOString(),
  };

  // 1. Required data — fail safely, never assume a placement is fine.
  check(
    VALIDATION_CODES.MISSING_REQUIRED_DATA,
    ctx.errors.length === 0 && isFinite(start) && isFinite(end),
    ctx.errors.join(' ') || (isFinite(start) ? '' : 'No proposed start time supplied.'),
    { errors: ctx.errors, coverage_error: ctx.coverage_error },
  );

  // 2. Service duration
  const durationOk = ctx.service_minutes > 0 && ctx.calendar_minutes > 0 && ctx.service_minutes <= MAX_SERVICE_MINUTES;
  check(
    VALIDATION_CODES.INVALID_SERVICE_DURATION,
    durationOk,
    durationOk ? '' : `Service duration (${ctx.service_minutes || 0} min) is not usable for scheduling.`,
    { service_minutes: ctx.service_minutes, configured_service_minutes: ctx.configured_service_minutes },
  );

  // 3. Customer availability — the submitted window is authoritative and is
  //    never modified. Only an explicit admin override (Schedule Anyway) may
  //    place outside it.
  let availabilityOk = true;
  let availabilityMessage = '';
  // True only when an override was actually used to place outside the customer's
  // availability — so a Booking Window override is never mistaken for one.
  let availabilityOverrideUsed = false;
  if (ctx.window && isFinite(start)) {
    const fitsInside = start >= ctx.window.start - 1e-6 && end <= ctx.window.end + 1e-6;
    if (!fitsInside) {
      if (options.admin_override_availability) {
        availabilityOverrideUsed = true;
        warn(VALIDATION_CODES.OUTSIDE_CUSTOMER_AVAILABILITY,
          `Admin override: placed outside the customer's ${ctx.window_raw} availability.`);
      } else {
        availabilityOk = false;
        availabilityMessage = `The booking needs ${ctx.calendar_minutes} minutes inside ${ctx.window_raw || 'the customer window'} (${decimalToLabel(ctx.window.start)}–${decimalToLabel(ctx.window.end)}).`;
      }
    }
  } else if (ctx.window_flexible) {
    warn(VALIDATION_CODES.OUTSIDE_CUSTOMER_AVAILABILITY, 'Customer availability is flexible — no window constraint applied.');
  }
  check(VALIDATION_CODES.OUTSIDE_CUSTOMER_AVAILABILITY, availabilityOk, availabilityMessage, {
    window: ctx.window,
    window_raw: ctx.window_raw,
    override_required: !availabilityOk,
  });

  // 4. Barber working hours — Route Flow may only use Normal Working Hours
  //    (as adjusted by Special Hours). Extended / After Hours are recognised
  //    and remain available to explicit manual admin scheduling only.
  let eligibility: 'normal' | 'extended' | 'after_hours' | 'closed' = 'closed';
  if (ctx.work.status === 'open' && ctx.work.normal && isFinite(start)) {
    const inNormal = start >= ctx.work.normal.start - 1e-6 && end <= ctx.work.normal.end + 1e-6;
    if (inNormal) eligibility = 'normal';
    else if (ctx.work.extended && start >= ctx.work.extended.start - 1e-6 && end <= ctx.work.extended.end + 1e-6) eligibility = 'extended';
    else eligibility = 'after_hours';
  } else if (ctx.work.status === 'open' && ctx.work.normal && isFinite(start)) {
    eligibility = 'after_hours';
  }
  let workingOk = eligibility === 'normal';
  let workingMessage = '';
  if (!workingOk) {
    if (eligibility === 'closed') {
      workingMessage = ctx.work.source === 'special_hours'
        ? `Closed on ${ctx.date}${ctx.work.label ? ` (${ctx.work.label})` : ''} — special hours override normal working hours.`
        : `Not a working day for ${ctx.barber_name || 'this barber'}.`;
    } else if (eligibility === 'extended') {
      workingMessage = 'Outside normal working hours (Extended Hours).';
      if (!automated) { workingOk = true; warn(VALIDATION_CODES.OUTSIDE_WORKING_HOURS, 'Placed in Extended Hours — manual scheduling only.'); }
    } else {
      workingMessage = ctx.work.source === 'special_hours'
        ? `Outside the Special Hours for ${ctx.date} (${decimalToLabel(ctx.work.normal.start)}–${decimalToLabel(ctx.work.normal.end)}${ctx.work.label ? ` — ${ctx.work.label}` : ''}).`
        : 'Outside normal working hours (After Hours).';
      if (!automated) { workingOk = true; warn(VALIDATION_CODES.OUTSIDE_WORKING_HOURS, 'Placed in After Hours — manual approval required.'); }
    }
  }
  check(VALIDATION_CODES.OUTSIDE_WORKING_HOURS, workingOk, workingOk ? '' : workingMessage, {
    eligibility,
    source: ctx.work.source,
    normal: ctx.work.normal,
    extended: ctx.work.extended,
  });

  // 5. Service coverage — existing backend classification. Outer areas keep
  //    their review behaviour; Outside areas are rejected.
  let coverageOk = true;
  let coverageMessage = '';
  if (ctx.coverage_error) {
    coverageOk = false;
    coverageMessage = `Service coverage could not be verified: ${ctx.coverage_error}`;
  } else if (ctx.coverage && ctx.coverage.tier === 'outside') {
    coverageOk = false;
    coverageMessage = 'The service address is outside the maximum service radius.';
  } else if (ctx.coverage && ctx.coverage.tier === 'outer') {
    warn(VALIDATION_CODES.COVERAGE_RESTRICTION, 'Outer area booking — flagged for review.');
  }
  check(VALIDATION_CODES.COVERAGE_RESTRICTION, coverageOk, coverageMessage, ctx.coverage || { error: ctx.coverage_error });

  // 6. Booking window — how soon and how far ahead a booking may be made.
  //    One rule, owned by Booking Rules and read identically by public booking,
  //    Route Flow (placement and reshuffle) and the manual calendar. Calculated
  //    in Sydney wall-clock time, so it is correct across daylight saving.
  //    Automation can never override it; only an explicit admin override can,
  //    and the caller records that reason in the audit trail.
  const now = options.now || Date.now();
  const windowSettings = ctx.booking_window || DEFAULT_BOOKING_WINDOW;
  const windowVerdict = bookingWindowVerdict({
    dateStr: ctx.date,
    startDecimal: start,
    window: windowSettings,
    now,
  });
  const mayOverrideWindow = !automated && options.admin_override_window === true;
  const windowCheck = (code: string, hit?: { code: string; message: string }) => {
    const details = {
      minimum_notice_hours: windowSettings.minimum_notice_hours,
      maximum_booking_days: windowSettings.maximum_booking_days,
      // Legacy field names kept for older readers of this result.
      enforced: true,
      earliest_start: new Date(now + windowSettings.minimum_notice_hours * 3600000).toISOString(),
    };
    if (!hit) { check(code, true, '', details); return; }
    if (mayOverrideWindow) {
      check(code, true, '', details);
      warn(code, `Admin override: ${hit.message}`);
      return;
    }
    check(code, false, hit.message, details);
  };
  windowCheck(VALIDATION_CODES.BOOKING_TOO_SOON,
    windowVerdict.violations.find(v => v.code === BOOKING_WINDOW_CODES.TOO_SOON));
  windowCheck(VALIDATION_CODES.BOOKING_TOO_FAR_AHEAD,
    windowVerdict.violations.find(v => v.code === BOOKING_WINDOW_CODES.TOO_FAR_AHEAD));

  // 7. Overlaps — active appointments and their buffers, protected breaks and
  //    blocked time. Cancelled historical records never block anything.
  const ignored = new Set(options.ignore_appointment_ids || []);
  const capacity = ctx.occupied.filter(o => !(o.kind === 'appointment' && ignored.has(o.id)));
  const overlapping = (isFinite(start) ? capacity.filter(o => overlaps(start, end, o.start, o.occupied_end)) : []);
  const protectedHits = overlapping.filter(o => o.kind === 'appointment' && (o.protection === 'locked' || o.protection === 'confirmed'));
  const completedHits = overlapping.filter(o => o.kind === 'appointment' && o.protection === 'completed');
  const plainHits = overlapping.filter(o => o.kind === 'appointment' && o.protection !== 'locked' && o.protection !== 'confirmed' && o.protection !== 'completed');
  const blockHits = overlapping.filter(o => o.kind === 'block');

  const brief = (list: OccupiedBlock[]) => list.map(o => `${o.label} ${decimalToLabel(o.start)}–${decimalToLabel(o.occupied_end)}`).join('; ');

  check(
    VALIDATION_CODES.PROTECTED_APPOINTMENT,
    protectedHits.length === 0,
    protectedHits.length === 0 ? '' : `Overlaps a protected appointment: ${brief(protectedHits)}. Locked and Confirmed times cannot be overlapped.`,
    { appointments: protectedHits.map(o => ({ id: o.id, label: o.label, protection: o.protection, start: o.start, end: o.occupied_end })) },
  );
  check(
    VALIDATION_CODES.APPOINTMENT_OVERLAP,
    plainHits.length === 0 && completedHits.length === 0,
    (plainHits.length === 0 && completedHits.length === 0)
      ? ''
      : `Overlaps existing capacity: ${brief([...plainHits, ...completedHits])}.`,
    { appointments: [...plainHits, ...completedHits].map(o => ({ id: o.id, label: o.label, protection: o.protection, start: o.start, end: o.occupied_end })) },
  );
  check(
    VALIDATION_CODES.BREAK_CONFLICT,
    blockHits.length === 0,
    blockHits.length === 0 ? '' : `Overlaps blocked time: ${brief(blockHits)}.`,
    { blocks: blockHits.map(o => ({ id: o.id, label: o.label, start: o.start, end: o.occupied_end })) },
  );

  // 8. Driving feasibility — the previous and next real appointments for the
  //    same date. A placement with no visual overlap can still be impossible.
  const travel = options.travel || { available: true, reason: null, mins: () => 0 } as TravelIndex;
  const travelChecks = evaluateTravel(capacity, travel, start, end, overlapping.map(o => o.id));

  // Travel remains a HARD constraint for every automated caller. A person may
  // deliberately place a time it cannot achieve — the shortfall is then reported
  // as a warning, the placement stands, and the caller records who decided and
  // why (options.admin_override_travel). Automation can never take this path.
  const mayOverrideTravel = !automated && options.admin_override_travel === true;
  const travelShort = travelChecks.insufficient.length > 0 || travelChecks.unverified.length > 0;
  const travelOverrideUsed = mayOverrideTravel && travelShort;
  if (travelOverrideUsed) {
    warn(VALIDATION_CODES.INSUFFICIENT_TRAVEL,
      `Admin override: travel time may not be achievable — ${[...travelChecks.insufficient, ...travelChecks.unverified].join(' ')}`.slice(0, 300));
  }
  check(VALIDATION_CODES.INSUFFICIENT_TRAVEL, travelChecks.insufficient.length === 0 || mayOverrideTravel,
    travelChecks.insufficient.join(' ') || '', { legs: travelChecks.legs });
  check(VALIDATION_CODES.TRAVEL_UNVERIFIED, travelChecks.unverified.length === 0 || mayOverrideTravel,
    travelChecks.unverified.join(' ') || '', { reason: travel.reason });

  // ── Timing breakdown (diagnostics) ────────────────────────────────────────
  // Exactly how this placement is built, with nothing hidden inside it:
  //   service end → configured buffer → required travel → next legal start
  const nextTravelMins = travelChecks.next?.required_mins ?? null;
  const timing = getEarliestFeasibleNextStart({
    previous: { start, service_minutes: ctx.service_minutes, buffer_minutes: ctx.buffer_minutes },
    travel_minutes: nextTravelMins,
  });

  const valid = violations.length === 0;
  return {
    ...base,
    valid,
    availability: {
      window_raw: ctx.window_raw,
      window: ctx.window,
      flexible: ctx.window_flexible,
      override_required: !availabilityOk,
      override_used: availabilityOverrideUsed,
    },
    working_hours: {
      status: ctx.work.status,
      source: ctx.work.source,
      label: ctx.work.label,
      normal: ctx.work.normal,
      extended: ctx.work.extended,
      eligibility,
    },
    coverage: ctx.coverage
      ? { tier: ctx.coverage.tier, allowed: ctx.coverage.allowed, matched_zone_name: ctx.coverage.matchedZoneName, distance_km: ctx.coverage.distanceFromZoneKm ?? ctx.coverage.distanceFromCoverageCentreKm }
      : { tier: null, allowed: false, error: ctx.coverage_error },
    capacity: {
      occupied_count: capacity.length,
      blocking: overlapping.map(o => ({ id: o.id, label: o.label, kind: o.kind, protection: o.protection, start: o.start, end: o.occupied_end })),
      drive_legs: ctx.drive_legs,
    },
    travel: {
      verified: travel.available,
      reason: travel.reason,
      previous: travelChecks.previous,
      next: travelChecks.next,
      override_used: travelOverrideUsed,
    },
    timing: {
      service_minutes: ctx.service_minutes,
      buffer_minutes: ctx.buffer_minutes,
      occupancy_minutes: ctx.calendar_minutes,
      service_end: isNaN(start) ? null : timing.service_end,
      buffer_end: isNaN(start) ? null : timing.buffer_end,
      required_travel_mins: nextTravelMins,
      earliest_next_start: isNaN(start) ? null : timing.earliest_start,
      step_minutes: STEP_MINUTES,
    },
    booking_window: {
      minimum_notice_hours: windowSettings.minimum_notice_hours,
      maximum_booking_days: windowSettings.maximum_booking_days,
      earliest_start: new Date(now + windowSettings.minimum_notice_hours * 3600000).toISOString(),
      violations: windowVerdict.violations,
    },
    checks,
    violations,
    warnings,
    codes: violations.map(v => v.code),
  };
}

/** Driving feasibility for the legs either side of the proposed appointment. */
function evaluateTravel(capacity: OccupiedBlock[], travel: TravelIndex, start: number, end: number, overlappingIds: string[]) {
  const insufficient: string[] = [];
  const unverified: string[] = [];
  const legs: any[] = [];

  const candidates = capacity.filter(o =>
    o.kind === 'appointment' && !overlappingIds.includes(o.id) && !(start < o.occupied_end && end > o.start)
  );

  const previous = candidates
    .filter(o => o.occupied_end <= start + 1e-6)
    .sort((a, b) => b.occupied_end - a.occupied_end)[0] || null;
  const next = candidates
    .filter(o => o.start >= end - 1e-6)
    .sort((a, b) => a.start - b.start)[0] || null;

  const buildLeg = (fromKey: string, toKey: string, availableMins: number, label: string) => {
    if (!travel.available) {
      unverified.push(`Travel ${label} could not be verified: ${travel.reason || 'no driving estimate'}.`);
      return { label, required_mins: null, available_mins: Math.round(availableMins), ok: false, verified: false };
    }
    const required = travel.mins(fromKey, toKey);
    if (required == null) {
      unverified.push(`Travel ${label} could not be verified — driving estimate unavailable.`);
      return { label, required_mins: null, available_mins: Math.round(availableMins), ok: false, verified: false };
    }
    const ok = required <= availableMins + 0.5;
    if (!ok) {
      insufficient.push(`The ${label} requires ${required} minutes of travel, but only ${Math.round(availableMins)} minutes are available.`);
    }
    return { label, required_mins: required, available_mins: Math.round(availableMins), ok, verified: true };
  };

  let previousLeg = null;
  if (previous?.point) {
    // Later appointment of the day — leg runs from the previous appointment.
    previousLeg = buildLeg(previous.id, 'PROPOSED', (start - previous.occupied_end) * 60, 'drive from the previous appointment');
    legs.push({ ...previousLeg, from: previous.label });
  } else if (travel.start) {
    // FIRST appointment of the day: there is no previous customer, so the leg
    // runs from the barber's saved start location. It carries no fixed time
    // budget (the barber leaves when the day requires), so it is recorded for
    // scoring and never used as a rejection by itself. An unconfigured start
    // location is NOT treated as zero travel — it is unverified, which blocks
    // automatic placement of a first-of-day appointment.
    const from = travel.start.address || "the barber's start location";
    const required = travel.start.configured && travel.start.point ? travel.mins('START', 'PROPOSED') : null;
    if (required == null) {
      unverified.push(travel.start.configured
        ? 'Travel from the start location could not be verified — driving estimate unavailable.'
        : 'Start location not configured — first-leg travel cannot be verified.');
      previousLeg = { label: 'drive from the start location', required_mins: null, available_mins: null, ok: false, verified: false, from_start: true, from };
    } else {
      previousLeg = { label: 'drive from the start location', required_mins: required, available_mins: null, ok: true, verified: true, from_start: true, from };
    }
    legs.push(previousLeg);
  }
  let nextLeg = null;
  if (next?.point) {
    nextLeg = buildLeg('PROPOSED', next.id, (next.start - end) * 60, 'drive to the next appointment');
    legs.push({ ...nextLeg, to: next.label });
  }

  return { insufficient, unverified, legs, previous: previousLeg, next: nextLeg };
}

// ── Convenience entry point ──────────────────────────────────────────────────

/**
 * Full validation for a single proposed start time: loads context, builds the
 * driving index, evaluates. Used by the validateBookingPlacement function and
 * the admin validator panel. Callers that evaluate many candidate slots should
 * use loadPlacementContext + buildTravelIndex + evaluatePlacement directly so
 * the Mapbox matrix is fetched once.
 */
export async function validatePlacement(
  base44: any,
  params: {
    booking: any;
    date?: string;
    barberId?: string | null;
    start: number;
    options?: EvaluateOptions;
  },
): Promise<PlacementResult> {
  const ctx = await loadPlacementContext(base44, {
    booking: params.booking,
    date: params.date,
    barberId: params.barberId,
  });
  const travel = await buildTravelIndex(ctx, pointOf(params.booking));
  return evaluatePlacement(ctx, params.start, { ...(params.options || {}), travel });
}

/**
 * Reads a barber's saved default start location from their profile.
 * Configured only when usable coordinates are stored: a saved address without
 * coordinates is reported as not configured, so the first leg can never be
 * silently scored as zero travel.
 */
export function readStartLocation(member: any): StartLocation | null {
  if (!member) return null;
  const address = String(member.start_location_address || '').trim();
  const rawLat = member.start_location_lat;
  const rawLng = member.start_location_lng;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const hasPoint = rawLat != null && rawLng != null &&
    isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return { configured: hasPoint, address, point: hasPoint ? { lat, lng } : null };
}

export function pointOf(booking: any): { lat: number; lng: number } | null {
  if (!booking) return null;
  if (typeof booking.address_lat === 'number' && typeof booking.address_lng === 'number') {
    return { lat: booking.address_lat, lng: booking.address_lng };
  }
  return null;
}