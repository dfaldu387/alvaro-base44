/**
 * Booking Window — the single source of truth for how soon and how far ahead a
 * booking may be made.
 *
 * Owned by Booking Rules (the BookingRules record) and read by every surface
 * that schedules: public booking, Route Flow (placement and reshuffle) and the
 * manual calendar. Every calculation happens in Australia/Sydney wall-clock time
 * and is DST-safe, so "24 hours notice" means 24 real hours whatever the offset
 * does on the day.
 *
 * One rule, one implementation: no caller re-derives the window, and the same
 * input always produces the same verdict. Automation can never override it —
 * only an explicit admin override ("Schedule Anyway"), whose reason the caller
 * records in the audit trail.
 */

import { parseWindow, parseTimeStr } from './provisionalPlacement.ts';

export const DEFAULT_MINIMUM_NOTICE_HOURS = 24;
export const DEFAULT_MAXIMUM_BOOKING_DAYS = 30;
/** Guard rails: a mistyped setting must never lock the business out or open a decade. */
export const MAX_NOTICE_HOURS = 24 * 14;
export const MAX_HORIZON_DAYS = 365;

const SYDNEY_TZ = 'Australia/Sydney';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface BookingWindow {
  minimum_notice_hours: number;
  maximum_booking_days: number;
}

export const DEFAULT_BOOKING_WINDOW: BookingWindow = {
  minimum_notice_hours: DEFAULT_MINIMUM_NOTICE_HOURS,
  maximum_booking_days: DEFAULT_MAXIMUM_BOOKING_DAYS,
};

/** The codes every surface reports a booking-window rejection with. */
export const BOOKING_WINDOW_CODES = {
  TOO_SOON: 'BOOKING_TOO_SOON',
  TOO_FAR_AHEAD: 'BOOKING_TOO_FAR_AHEAD',
};

export interface WindowViolation {
  code: string;
  message: string;
}

// ── Sydney wall clock (DST-safe) ─────────────────────────────────────────────

/** Offset of `tz` from UTC, in minutes, at the given instant. */
function tzOffsetMinutes(ms: number, tz: string = SYDNEY_TZ): number {
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Sydney wall-clock date (YYYY-MM-DD) of an instant, optionally shifted by whole days. */
export function sydneyDateOf(epochMs: number, addDays = 0): string {
  const local = new Date(epochMs + tzOffsetMinutes(epochMs) * 60000);
  const shifted = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Calendar-day arithmetic on a YYYY-MM-DD date string. */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date string. */
export function weekdayIndexOf(dateStr: string): number {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return 0;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayNameOf(dateStr: string): string {
  return DAY_NAMES[weekdayIndexOf(dateStr)] || '';
}

/** Sydney wall-clock date + decimal hour → epoch ms. Correct across DST. */
export function sydneyEpochOf(dateStr: string, decimalHour: number): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !isFinite(decimalHour)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const hh = Math.floor(decimalHour);
  const mm = Math.round((decimalHour - hh) * 60);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let offset = tzOffsetMinutes(naive);
  let ts = naive - offset * 60000;
  offset = tzOffsetMinutes(ts);
  ts = naive - offset * 60000;
  return ts;
}

/** "24-hour" / "1.5-hour" / "30-minute" — the label the customer and admin read. */
export function noticeLabel(hours: number): string {
  const h = Number(hours) || 0;
  if (h >= 1) return `${Number(h.toFixed(2))}-hour`;
  return `${Math.round(h * 60)}-minute`;
}

// ── Settings ─────────────────────────────────────────────────────────────────

/** Clamps a stored record (or any input) into a usable window. */
export function normaliseBookingWindow(record: any): BookingWindow {
  const notice = Number(record?.minimum_notice_hours);
  const horizon = Number(record?.maximum_booking_days);
  return {
    minimum_notice_hours: isFinite(notice)
      ? Math.min(Math.max(notice, 0), MAX_NOTICE_HOURS)
      : DEFAULT_MINIMUM_NOTICE_HOURS,
    maximum_booking_days: isFinite(horizon)
      ? Math.min(Math.max(Math.round(horizon), 1), MAX_HORIZON_DAYS)
      : DEFAULT_MAXIMUM_BOOKING_DAYS,
  };
}

/**
 * Reads the one BookingRules record. Always fresh, never cached — a settings
 * change applies to the very next booking, Route Flow pass or calendar check.
 */
export async function loadBookingWindow(client: any): Promise<BookingWindow> {
  try {
    const rows = await client.entities.BookingRules.list('-created_date', 1);
    return normaliseBookingWindow((rows || [])[0]);
  } catch {
    // A settings read must never block scheduling — the documented defaults apply.
    return DEFAULT_BOOKING_WINDOW;
  }
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

/** The last moment on a date an appointment could start, from the submitted window. */
function latestStartOn(dateStr: string, availabilityWindow: string, afterHoursSlot: string | null): number {
  const slot = afterHoursSlot ? parseTimeStr(afterHoursSlot) : NaN;
  if (isFinite(slot)) return slot;
  const window = parseWindow(availabilityWindow);
  if (window) return window.end;
  return 24; // flexible — the whole day is available
}

/** The date a booking horizon reaches to, inclusive. */
export function latestBookableDateStr(window: BookingWindow, now: number = Date.now()): string {
  const win = window || DEFAULT_BOOKING_WINDOW;
  return sydneyDateOf(now, win.maximum_booking_days);
}

/**
 * The first date a customer may book: the earliest date whose day has not been
 * entirely swallowed by the notice period. With 24 hours notice that is
 * tomorrow; with 0 hours it is today.
 */
export function earliestBookableDateStr(window: BookingWindow, now: number = Date.now()): string {
  const win = window || DEFAULT_BOOKING_WINDOW;
  const noticeMs = win.minimum_notice_hours * 3600000;
  for (let i = 0; i <= Math.min(win.maximum_booking_days, 90); i++) {
    const dateStr = sydneyDateOf(now, i);
    const endOfDay = sydneyEpochOf(dateStr, 24);
    if (endOfDay == null || endOfDay > now + noticeMs) return dateStr;
  }
  return sydneyDateOf(now);
}

/**
 * How many dates the public booking calendar should offer: every date from the
 * first the notice period allows to the last the horizon allows, inclusive.
 * The display is capped so an extreme horizon cannot render an endess ribbon —
 * the cap only ever narrows what is offered, never widens it.
 */
export function bookableWindowDayCount(window: BookingWindow, now: number = Date.now()): number {
  const win = window || DEFAULT_BOOKING_WINDOW;
  const first = Date.parse(`${earliestBookableDateStr(win, now)}T00:00:00Z`);
  const last = Date.parse(`${latestBookableDateStr(win, now)}T00:00:00Z`);
  if (!isFinite(first) || !isFinite(last) || last < first) return 1;
  const days = Math.round((last - first) / 86400000) + 1;
  return Math.min(Math.max(days, 1), 92);
}

/**
 * Per-appointment verdict — the rule the shared scheduling validator applies for
 * Route Flow, reshuffle, drag/drop and every manual placement.
 */
export function bookingWindowVerdict(params: {
  dateStr: string;
  startDecimal: number;
  window?: BookingWindow;
  now?: number;
}): { ok: boolean; violations: WindowViolation[] } {
  const win = params.window || DEFAULT_BOOKING_WINDOW;
  const now = params.now || Date.now();
  const violations: WindowViolation[] = [];

  const start = sydneyEpochOf(params.dateStr, params.startDecimal);
  if (start != null && win.minimum_notice_hours > 0 && start < now + win.minimum_notice_hours * 3600000) {
    violations.push({
      code: BOOKING_WINDOW_CODES.TOO_SOON,
      message: `This appointment is inside the ${noticeLabel(win.minimum_notice_hours)} minimum notice period.`,
    });
  }
  if (params.dateStr && params.dateStr > latestBookableDateStr(win, now)) {
    violations.push({
      code: BOOKING_WINDOW_CODES.TOO_FAR_AHEAD,
      message: `This appointment is beyond the ${win.maximum_booking_days}-day booking horizon.`,
    });
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Date-level verdict for a submitted public request. The customer submits a day
 * and an availability window, not an exact time, so the whole window is measured:
 * if even its latest start falls inside the notice period, the date is not
 * bookable. The backend re-checks this on submit, so disabling dates in the
 * browser is convenience only, never the enforcement.
 */
export function publicBookingWindowVerdict(params: {
  dateStr: string;
  availabilityWindow?: string;
  afterHoursSlot?: string | null;
  window?: BookingWindow;
  now?: number;
}): { ok: boolean; code?: string; error?: string } {
  const win = params.window || DEFAULT_BOOKING_WINDOW;
  const now = params.now || Date.now();
  const dateStr = String(params.dateStr || '').trim().slice(0, 10);
  if (!dateStr) return { ok: true };

  if (dateStr > latestBookableDateStr(win, now)) {
    return {
      ok: false,
      code: BOOKING_WINDOW_CODES.TOO_FAR_AHEAD,
      error: `This date is beyond our ${win.maximum_booking_days}-day booking window. Please choose an earlier date.`,
    };
  }

  if (win.minimum_notice_hours > 0) {
    const latest = latestStartOn(dateStr, params.availabilityWindow || '', params.afterHoursSlot || null);
    const latestEpoch = sydneyEpochOf(dateStr, latest);
    if (latestEpoch != null && latestEpoch < now + win.minimum_notice_hours * 3600000) {
      const label = win.minimum_notice_hours >= 24
        ? `${Math.round(win.minimum_notice_hours / 24)}-day`
        : noticeLabel(win.minimum_notice_hours);
      return {
        ok: false,
        code: BOOKING_WINDOW_CODES.TOO_SOON,
        error: `This date is inside our ${label} notice period. Please choose a later date.`,
      };
    }
  }

  return { ok: true };
}