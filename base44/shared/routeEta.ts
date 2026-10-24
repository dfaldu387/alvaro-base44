/**
 * Live ETA for a finalised day route. PURE: it reads the data passed in and
 * returns numbers. No entity reads, no writes, no clock of its own (`now` is an
 * argument), so every rule below is unit-testable.
 *
 * THE DELAY MODEL
 *   1. Anchor. Walk the route from the last stop backwards and take the first
 *      stop that has a real timestamp on the route's date: a `completed_at`, or
 *      a `started_at` (a cut in progress). Skipped stops never anchor.
 *   2. Delay at the anchor, measured against the SERVICE time, so the buffer
 *      cancels out:
 *         planned service end = planned start + service minutes
 *         actual service end  = completed_at
 *                               | started_at + service minutes (in progress;
 *                                 never earlier than `now` - a cut cannot have
 *                                 ended in the past if it has not been completed)
 *         delay = max(0, actual service end - planned service end)
 *      A negative delay is clamped to 0: running early never promises an earlier
 *      arrival than the booked time.
 *   3. Carry forward. The anchor's occupancy ends at (planned end + delay).
 *      Each later stop is then reached by adding the route's own stored,
 *      verified driving time:
 *         arrive(k) = estimated occupancy end(k-1) + drive(k-1 -> k)
 *         eta(k)    = max(planned start(k), arrive(k))      <- never early
 *         estimated occupancy end(k) = eta(k) + planned occupancy(k)
 *      Idle slack in the plan therefore absorbs delay, exactly as it would on
 *      the road. The order is never changed and nothing is re-optimised.
 *   4. A stop that is already completed has no ETA; it has an actual time.
 *   5. No finalised route, a route that no longer matches the day, driving
 *      times that were never verified, or an anchor whose service length is
 *      unknown: the whole route is `eta_unavailable` with the reason. There is
 *      no fallback guess.
 *
 * Times are minutes after midnight on the route's date, Australia/Sydney wall
 * clock (the same clock the stored stop labels use).
 */

export const ETA_TZ = 'Australia/Sydney';
/** Width of the arrival window shown to customers. */
export const WINDOW_MINUTES = 15;
/** The window start is the ETA rounded DOWN to this many minutes. */
export const WINDOW_STEP_MINUTES = 5;

export type EtaUnavailableReason =
  | 'no_finalised_route'
  | 'route_needs_update'
  | 'driving_times_unverified'
  | 'service_duration_missing'
  | 'route_times_unreadable';

export const ETA_REASON_TEXT: Record<EtaUnavailableReason, string> = {
  no_finalised_route: 'This day has no finalised route.',
  route_needs_update: 'The day changed after the route was finalised. Rebuild the route to get live times.',
  driving_times_unverified: 'The route has driving times that were never verified.',
  service_duration_missing: 'The length of the stop in progress is not known.',
  route_times_unreadable: 'The route has stop times that could not be read.',
};

export interface EtaStopInput {
  booking_request_id: string;
  order?: number;
  start_label?: string;
  start_decimal?: number;
  end_label?: string;
  /** Verified driving minutes from this stop to the next one. */
  drive_minutes?: number | null;
}

export interface EtaExecutionInput {
  booking_request_id: string;
  state?: string;
  arrived_at?: string;
  started_at?: string;
  completed_at?: string;
}

export interface EtaRouteInput {
  id?: string;
  route_status?: string;
  team_member_id?: string;
  team_member_name?: string;
  stops?: EtaStopInput[];
  stop_execution?: EtaExecutionInput[];
}

/**
 * OPTIONAL live position, passed in by the caller (this module never fetches it).
 * `drive_minutes` is the road time from the position to the stop, measured by the
 * caller at `measured_at`. A fix is used ONLY when every check in `liveArrival`
 * passes; otherwise it is discarded whole and the tap-based result stands.
 */
export interface LivePositionInput {
  lat: number;
  lng: number;
  accuracy_m: number;
  /** When the device took the position (ISO). */
  taken_at: string;
  /** The stop the drive time was measured to. */
  stop_id: string;
  /** Remaining road drive from the position to that stop, in minutes. */
  drive_minutes: number;
  /** When that drive time was measured (ISO). */
  measured_at: string;
}

/** A fix older than this (seconds) is discarded. */
export const LIVE_FIX_MAX_AGE_SECONDS = 300;
/** A fix less accurate than this (metres, the device's own radius) is discarded. */
export const LIVE_FIX_MAX_ACCURACY_M = 100;
/**
 * "Plausibly on the route": the remaining drive may not exceed the larger of this
 * many minutes or LIVE_DRIVE_CAP_FACTOR x the planned drive into the stop.
 */
export const LIVE_DRIVE_CAP_MINUTES = 60;
export const LIVE_DRIVE_CAP_FACTOR = 3;

export interface EtaInput {
  /** The route's service date, YYYY-MM-DD. */
  date: string;
  route: EtaRouteInput | null | undefined;
  /** Service minutes per booking id (BookingRequest.duration_mins). */
  service_minutes?: Record<string, number>;
  now: Date;
  /** Optional barber position for the stop that is on_the_way. Absent = today's behaviour exactly. */
  live?: LivePositionInput | null;
}

export interface EtaStop {
  booking_request_id: string;
  order: number;
  state: string;
  planned_start_label: string | null;
  eta_start_label: string | null;
  /** The 15-minute arrival window, e.g. "2:15pm–2:30pm". Null when there is no ETA. */
  window_label: string | null;
  window_start_label: string | null;
  window_end_label: string | null;
  /** Minutes past the booked time (>= 0). Null when the stop has no ETA. */
  delay_minutes: number | null;
  /** Completed (or started) stops: what actually happened. */
  actual: { start_label: string | null; end_label: string | null } | null;
}

export interface EtaAnchor {
  booking_request_id: string;
  order: number;
  kind: 'completed' | 'in_progress';
  /** Delay carried forward (clamped, >= 0). */
  delay_minutes: number;
  /** Before clamping: negative means the day is running early. */
  raw_delay_minutes: number;
}

export interface RouteEta {
  date: string;
  route_id: string | null;
  team_member_id: string | null;
  team_member_name: string | null;
  status: 'ok' | 'eta_unavailable';
  reason: EtaUnavailableReason | null;
  reason_text: string | null;
  /** The day's current slip in minutes (0 = on time). Null when unavailable. */
  delay_minutes: number | null;
  anchor: EtaAnchor | null;
  stops: EtaStop[];
  /** Present only when a trustworthy live position set an arrival time. */
  live_stop_id?: string;
}

// ── Clock helpers ────────────────────────────────────────────────────────────

const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: ETA_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Sydney wall-clock date and minutes-after-midnight for an instant. */
export function sydneyClock(ms: number): { date: string; minutes: number } {
  const p: Record<string, string> = {};
  for (const part of clock.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60,
  };
}

/** Minutes after midnight for a timestamp, only if it falls on `date` (Sydney). Otherwise null. */
function minutesOnDate(iso: unknown, date: string): number | null {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return null;
  const c = sydneyClock(ms);
  return c.date === date ? Math.round(c.minutes) : null;
}

/** "10:00am" / "2:15 PM" -> minutes after midnight, or NaN. */
export function labelToMinutes(label: unknown): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([ap])m?\s*$/i.exec(String(label || ''));
  if (!m) return NaN;
  const h = Number(m[1]) % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0);
  return h * 60 + Number(m[2]);
}

/** Minutes after midnight -> "2:15pm". */
export function minutesToLabel(mins: number): string {
  const t = Math.round(mins);
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

function plannedStartMinutes(s: EtaStopInput): number {
  if (Number.isFinite(Number(s.start_decimal)) && s.start_decimal !== null && s.start_decimal !== undefined) {
    return Math.round(Number(s.start_decimal) * 60);
  }
  return labelToMinutes(s.start_label);
}

/** The arrival window for an ETA: starts at the ETA rounded down to 5 min, lasts 15. */
export function arrivalWindow(etaMinutes: number) {
  const start = Math.floor((etaMinutes + 1e-6) / WINDOW_STEP_MINUTES) * WINDOW_STEP_MINUTES;
  const end = start + WINDOW_MINUTES;
  const a = minutesToLabel(start);
  const b = minutesToLabel(end);
  return { start_label: a, end_label: b, label: `${a}–${b}` };
}

/** The sentence that goes in a customer message, or '' when there is no ETA. */
export function windowPhrase(stop: Pick<EtaStop, 'window_start_label' | 'window_end_label'> | null | undefined): string {
  return stop?.window_start_label && stop?.window_end_label
    ? `Arriving between ${stop.window_start_label} and ${stop.window_end_label}.`
    : '';
}

/**
 * The arrival (minutes after midnight) a trustworthy live position gives for
 * `stopId`, or null. Null for ANY failed check: nothing is down-weighted.
 */
export function liveArrival(live: LivePositionInput | null | undefined, stopId: string, plannedLegMinutes: number, nowMs: number, date: string): number | null {
  if (!live || String(live.stop_id) !== stopId) return null;
  const { lat, lng, accuracy_m, drive_minutes } = live;
  if (![lat, lng, accuracy_m, drive_minutes].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  if (accuracy_m <= 0 || accuracy_m > LIVE_FIX_MAX_ACCURACY_M) return null;
  const maxAgeMs = LIVE_FIX_MAX_AGE_SECONDS * 1000;
  for (const iso of [live.taken_at, live.measured_at]) {
    const ms = Date.parse(String(iso || ''));
    if (!Number.isFinite(ms) || nowMs - ms > maxAgeMs || ms - nowMs > 60000) return null;
  }
  const cap = Math.max(LIVE_DRIVE_CAP_MINUTES, LIVE_DRIVE_CAP_FACTOR * (Number.isFinite(plannedLegMinutes) ? plannedLegMinutes : 0));
  if (drive_minutes < 0 || drive_minutes > cap) return null;
  const measured = sydneyClock(Date.parse(live.measured_at));
  if (measured.date !== date) return null;
  return Math.ceil(measured.minutes + drive_minutes);
}

// ── The model ────────────────────────────────────────────────────────────────

const IN_PROGRESS_OR_LATER = ['arrived', 'in_service', 'completed'];

function emptyStop(row: { id: string; order: number; state: string; start: number }): EtaStop {
  return {
    booking_request_id: row.id,
    order: row.order,
    state: row.state,
    planned_start_label: Number.isFinite(row.start) ? minutesToLabel(row.start) : null,
    eta_start_label: null,
    window_label: null,
    window_start_label: null,
    window_end_label: null,
    delay_minutes: null,
    actual: null,
  };
}

export function computeRouteEta(input: EtaInput): RouteEta {
  const { date, route, now } = input;
  const base = {
    date,
    route_id: route?.id ?? null,
    team_member_id: route?.team_member_id ?? null,
    team_member_name: route?.team_member_name ?? null,
  };

  const sorted = [...(route?.stops || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const execById = new Map<string, EtaExecutionInput>();
  for (const e of route?.stop_execution || []) execById.set(String(e.booking_request_id), e);

  const rows = sorted.map((s, i) => ({
    id: String(s.booking_request_id),
    order: Number(s.order || i + 1),
    start: plannedStartMinutes(s),
    end: labelToMinutes(s.end_label),
    drive: s.drive_minutes === null || s.drive_minutes === undefined ? NaN : Number(s.drive_minutes),
    exec: execById.get(String(s.booking_request_id)),
    state: String(execById.get(String(s.booking_request_id))?.state || 'planned'),
  }));

  const unavailable = (reason: EtaUnavailableReason, withStops = true): RouteEta => ({
    ...base,
    status: 'eta_unavailable',
    reason,
    reason_text: ETA_REASON_TEXT[reason],
    delay_minutes: null,
    anchor: null,
    stops: withStops ? rows.map(emptyStop) : [],
  });

  // 1. A finalised route is the only thing an ETA can be built on.
  if (!route || rows.length === 0) return unavailable('no_finalised_route', false);
  if (route.route_status === 'needs_update') return unavailable('route_needs_update');
  if (route.route_status !== 'finalised') return unavailable('no_finalised_route', false);

  // 2. Every stop time must be readable, and every driving leg must be verified.
  if (rows.some(r => !Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start)) {
    return unavailable('route_times_unreadable');
  }
  for (let i = 0; i < rows.length - 1; i++) {
    if (!Number.isFinite(rows[i].drive) || rows[i].drive < 0) return unavailable('driving_times_unverified');
  }

  // 3. The anchor: the last stop with a real timestamp on this date.
  let anchorIdx = -1;
  let anchorKind: 'completed' | 'in_progress' | null = null;
  let completedAt: number | null = null;
  let startedAt: number | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.state === 'skipped') continue;
    const done = minutesOnDate(r.exec?.completed_at, date);
    if (done !== null) { anchorIdx = i; anchorKind = 'completed'; completedAt = done; break; }
    const began = minutesOnDate(r.exec?.started_at, date);
    if (began !== null) { anchorIdx = i; anchorKind = 'in_progress'; startedAt = began; break; }
  }

  let delay = 0;
  let rawDelay = 0;
  let anchor: EtaAnchor | null = null;
  if (anchorIdx >= 0 && anchorKind) {
    const a = rows[anchorIdx];
    const service = Number(input.service_minutes?.[a.id]);
    if (!Number.isFinite(service) || service <= 0) return unavailable('service_duration_missing');
    const plannedServiceEnd = a.start + service;
    let actualServiceEnd: number;
    if (anchorKind === 'completed') {
      actualServiceEnd = completedAt as number;
    } else {
      actualServiceEnd = (startedAt as number) + service;
      const nowMin = minutesOnDate(now.toISOString(), date);
      if (nowMin !== null) actualServiceEnd = Math.max(actualServiceEnd, nowMin);
    }
    rawDelay = Math.round(actualServiceEnd - plannedServiceEnd);
    delay = Math.max(0, rawDelay);
    anchor = { booking_request_id: a.id, order: a.order, kind: anchorKind, delay_minutes: delay, raw_delay_minutes: rawDelay };
  }

  // 4. Walk the route and build every stop.
  const stops: EtaStop[] = rows.map(emptyStop);
  let prevOccupancyEnd = anchorIdx >= 0 ? rows[anchorIdx].end + delay : 0;
  let chainBroken = false;
  // Live position: only ever LATER than the tap-based time, never earlier (see max() below).
  let liveStopId: string | undefined;
  let liveCarry: number | null = null; // no-anchor days only: occupancy end after a live-timed stop
  const liveFor = (i: number): number | null =>
    rows[i].state === 'on_the_way'
      ? liveArrival(input.live, rows[i].id, i > 0 ? rows[i - 1].drive : NaN, now.getTime(), date)
      : null;

  rows.forEach((r, i) => {
    const out = stops[i];
    const done = minutesOnDate(r.exec?.completed_at, date);
    const began = minutesOnDate(r.exec?.started_at, date);
    if (r.state === 'completed' || done !== null || (began !== null && IN_PROGRESS_OR_LATER.includes(r.state))) {
      out.actual = {
        start_label: began !== null ? minutesToLabel(began) : null,
        end_label: done !== null ? minutesToLabel(done) : null,
      };
    }
    // A completed stop has an actual time, never an ETA. Stops behind the anchor that
    // were never worked are simply behind us.
    if (r.state === 'completed' || done !== null) return;
    if (r.state === 'skipped') { chainBroken = true; return; }
    if (i === anchorIdx) return;
    if (anchorIdx >= 0 && i < anchorIdx) return;

    if (anchorIdx < 0) {
      // Nothing has been timed yet: the plan is the estimate. Delay 0 - unless a
      // trustworthy position says the stop in transit is further away than planned.
      const la = liveFor(i);
      const carried = liveCarry !== null && !chainBroken ? liveCarry + rows[i - 1].drive : -Infinity;
      if (la === null && liveCarry === null) { setEta(out, r.start, r.start); return; }
      const eta = Math.max(r.start, carried, la ?? -Infinity);
      setEta(out, eta, r.start);
      if (la !== null && la > r.start) liveStopId = r.id;
      liveCarry = eta + (r.end - r.start);
      return;
    }
    if (chainBroken) return; // the leg through a skipped stop was never verified

    const arrive = prevOccupancyEnd + rows[i - 1].drive;
    const la = liveFor(i);
    const eta = Math.max(r.start, arrive, la ?? -Infinity);
    if (la !== null && la > Math.max(r.start, arrive)) liveStopId = r.id;
    setEta(out, eta, r.start);
    prevOccupancyEnd = eta + (r.end - r.start);
  });

  // When a live position moved a time, the day's slip is the worst stop slip, so the
  // existing running-late rules see it. Without one this is exactly `delay`.
  const daySlip = liveStopId
    ? Math.max(delay, ...stops.map(s => s.delay_minutes ?? 0))
    : delay;

  return {
    ...base,
    status: 'ok',
    reason: null,
    reason_text: null,
    delay_minutes: daySlip,
    anchor,
    stops,
    ...(liveStopId ? { live_stop_id: liveStopId } : {}),
  };
}

function setEta(out: EtaStop, etaMin: number, plannedStart: number) {
  const w = arrivalWindow(etaMin);
  out.eta_start_label = minutesToLabel(etaMin);
  out.window_label = w.label;
  out.window_start_label = w.start_label;
  out.window_end_label = w.end_label;
  out.delay_minutes = Math.max(0, Math.round(etaMin - plannedStart));
}