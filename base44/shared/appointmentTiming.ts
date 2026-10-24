/**
 * Appointment timing — the ONE calculation of how long an appointment occupies
 * and when the next one may legally start.
 *
 * Occupancy is:
 *
 *     service duration + the buffer CONFIGURED on the service
 *
 * There is no hidden default buffer. A service with no buffer configured — the
 * normal case — occupies exactly its service time. Before this module the engine
 * substituted a flat 25-minute buffer for every booking, which is what made a
 * 45-minute Haircut + Beard look like 70 minutes of reserved capacity
 * (9:00am → 10:10am) and pushed every following appointment 25 minutes later.
 *
 * Travel is NOT occupancy. It is a derived constraint BETWEEN two appointments:
 *
 *     9:00 ── 9:45 service ── 9:50 buffer ── 10:05 arrival
 *             (45 min)         (+5 min)       (+15 min travel)
 *                                            ⇒ next appointment may start 10:05
 *
 * Idle time is only what is left over after that — it is never added by this
 * module. `getEarliestFeasibleNextStart` is that rule, in one place, shared by:
 *
 *   schedulingValidator.ts  Route Flow placement, manual calendar moves,
 *                           reshuffle validation and Stage 2.1 fit
 *   routeFlowOptimiser.ts   Stage 2 reshuffle + Stage 2.1 fit occupancy
 *   routeFlowEngine.ts      concurrent-write detection
 *   src/lib/appointmentTiming.js mirrors this rule for the calendar's visuals
 *
 * Scheduling keeps its 5-minute increments: a calculated 10:03 arrival is
 * offered as 10:05, never as 10:00.
 */

/** The scheduling increment. Appointments start on these marks and nowhere else. */
export const STEP_MINUTES = 5;

/** Round a decimal hour UP to the scheduling increment (10:03 → 10:05). */
export function snapUpToStep(dec: number, stepMins: number = STEP_MINUTES): number {
  const step = stepMins || STEP_MINUTES;
  // Whole minutes, so floating-point drift cannot add a phantom step.
  return Math.round(Math.ceil(dec * 60 / step - 1e-6) * step) / 60;
}

/** A configured buffer of 0 means exactly that: no time is added. */
export function normaliseBufferMinutes(raw: unknown): number {
  const n = Number(raw);
  return isFinite(n) && n > 0 ? n : 0;
}

/** What the calendar holds for one appointment: service + configured buffer. */
export function occupancyMinutes(serviceMinutes: number, bufferMinutes: number): number {
  const service = Number(serviceMinutes) || 0;
  if (!(service > 0)) return 0;
  return service + normaliseBufferMinutes(bufferMinutes);
}

function nameKey(value: unknown): string {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/** The services and add-ons a booking is made of, by normalised name. */
function bookingItemNames(booking: any): { primary: string[]; addons: string[] } {
  const participants = Array.isArray(booking?.participants) ? booking.participants : [];
  if (participants.length > 0) {
    const primary: string[] = [];
    const addons: string[] = [];
    for (const p of participants) {
      const name = nameKey(p?.primary_service);
      if (name) primary.push(name);
      for (const a of (p?.addons || [])) {
        const addonName = nameKey(a);
        if (addonName) addons.push(addonName);
      }
    }
    return { primary, addons };
  }
  return { primary: (booking?.services || []).map(nameKey).filter(Boolean), addons: [] };
}

export interface BookingTiming {
  configured_service_minutes: number;
  service_minutes: number;
  buffer_minutes: number;
  occupancy_minutes: number;
}

/**
 * Service minutes and configured buffer for one booking, from the live
 * catalogue. The stored duration_mins is itself computed server-side from the
 * same configuration, so it wins and is NEVER added to the recalculated value.
 */
export function resolveBookingTiming(
  booking: any,
  serviceByName: Map<string, any>,
  addonByName: Map<string, any>,
): BookingTiming {
  const { primary, addons } = bookingItemNames(booking);
  let configuredService = 0;
  let bufferMinutes = 0;

  for (const name of primary) {
    const svc = serviceByName.get(name);
    configuredService += Number(svc?.duration_mins) || 0;
    // One buffer per booking: group participants are served one after another,
    // never in parallel. Add-ons add service time only, never a second buffer.
    if (svc) bufferMinutes = Math.max(bufferMinutes, normaliseBufferMinutes(svc?.buffer_mins));
  }
  for (const name of addons) {
    configuredService += Number(addonByName.get(name)?.duration_adjustment) || 0;
  }

  const stored = Number(booking?.duration_mins) || 0;
  const serviceMinutes = stored > 0 ? stored : configuredService;
  const buffer = normaliseBufferMinutes(bufferMinutes);

  return {
    configured_service_minutes: configuredService,
    service_minutes: serviceMinutes,
    buffer_minutes: buffer,
    occupancy_minutes: occupancyMinutes(serviceMinutes, buffer),
  };
}

/** Just the configured buffer — for records that already carry a duration. */
export function bufferMinutesForBooking(
  booking: any,
  serviceByName: Map<string, any>,
  addonByName: Map<string, any>,
): number {
  return resolveBookingTiming(booking, serviceByName, addonByName).buffer_minutes;
}

export interface TimingStep {
  /** Start time as a decimal hour. */
  start: number;
  service_minutes: number;
  buffer_minutes?: number;
}

export interface EarliestStart {
  service_end: number;
  buffer_end: number;
  arrival: number;
  earliest_start: number;
  travel_minutes: number | null;
  step_minutes: number;
  /** What pushed the start later: travel, availability, working_hours, or nothing. */
  constrained_by: 'travel' | 'availability' | 'working_hours' | null;
}

/**
 * The next appointment may start at:
 *
 *     previous service end + previous configured buffer + required travel
 *
 * rounded UP to the scheduling increment and never earlier than the next
 * customer's availability or the barber's working hours. Nothing else is added.
 */
export function getEarliestFeasibleNextStart(params: {
  previous: TimingStep;
  /** Road travel from the previous appointment's address. null = not estimated yet. */
  travel_minutes?: number | null;
  /** The next appointment's own floors, when they are known. */
  not_before?: number | null;
  work_start?: number | null;
  step_minutes?: number;
}): EarliestStart {
  const step = params.step_minutes || STEP_MINUTES;
  const serviceEnd = params.previous.start + (Number(params.previous.service_minutes) || 0) / 60;
  const bufferEnd = serviceEnd + normaliseBufferMinutes(params.previous.buffer_minutes) / 60;

  // Travel is counted ONCE, between the buffer end and the arrival. An unknown
  // estimate is never free travel: callers that require verification treat null
  // as unverified, so this module leaves it out rather than assuming zero.
  const travel = params.travel_minutes == null ? null : Math.max(0, Number(params.travel_minutes) || 0);
  const arrival = travel == null ? bufferEnd : bufferEnd + travel / 60;

  let earliest = snapUpToStep(arrival, step);
  let constrainedBy: EarliestStart['constrained_by'] = travel != null && travel > 0 ? 'travel' : null;

  const floors: Array<{ value: number; by: 'availability' | 'working_hours' }> = [];
  if (params.not_before != null && isFinite(Number(params.not_before))) {
    floors.push({ value: Number(params.not_before), by: 'availability' });
  }
  if (params.work_start != null && isFinite(Number(params.work_start))) {
    floors.push({ value: Number(params.work_start), by: 'working_hours' });
  }
  for (const floor of floors) {
    if (floor.value > earliest + 1e-9) {
      earliest = snapUpToStep(floor.value, step);
      constrainedBy = floor.by;
    }
  }

  return {
    service_end: serviceEnd,
    buffer_end: bufferEnd,
    arrival,
    earliest_start: earliest,
    travel_minutes: travel,
    step_minutes: step,
    constrained_by: constrainedBy,
  };
}