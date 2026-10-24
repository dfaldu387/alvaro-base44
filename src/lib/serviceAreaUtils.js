// Service Area helpers — shared by the admin editor and the public booking flow.
//
// The ServiceArea entity is the source of truth for which areas are serviced,
// which days, and what hours. The public booking flow must not hard-code
// service days/regions; it derives them from active ServiceArea records.
import { decimalToLabel } from './demandUtils';

export const WEEK_DAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export const DAY_SHORT = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

// Standard time blocks used to split a working window into named periods.
const BLOCK_BOUNDARIES = [9, 12, 15, 18, 21];
function blockNameFor(mid) {
  if (mid < 12) return 'Morning';
  if (mid < 15) return 'Midday';
  if (mid < 18) return 'Afternoon';
  return 'Evening';
}

// Split a [open, close] window into contiguous named periods aligned to the
// standard block boundaries, merging adjacent segments with the same name.
function splitWindowToPeriods(open, close) {
  if (open == null || close == null || close <= open) return [];
  const cuts = [open];
  for (const b of BLOCK_BOUNDARIES) {
    if (b > open && b < close) cuts.push(b);
  }
  cuts.push(close);
  const segs = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i];
    const e = cuts[i + 1];
    const name = blockNameFor((s + e) / 2);
    const last = segs[segs.length - 1];
    if (last && last.name === name) {
      last.end = e;
    } else {
      segs.push({ name, start: s, end: e });
    }
  }
  return segs.map(p => ({ ...p, label: `${decimalToLabel(p.start)}–${decimalToLabel(p.end)}` }));
}

// Build the public booking day configuration from sanitised active service areas.
// Returns:
//   dayPeriods: { Tuesday: [{name,start,end,label}], ... }
//   dayLatestStart: { Tuesday: '5:00pm', ... }  (close - 1h default buffer)
//   dayMaxBookings: { Tuesday: 8, ... }          (max day-level cap across areas)
//   bookableDays: Set<string>
// Build the public booking day configuration from TWO separate sources:
//   1. Barber working hours (WHEN) — the default public booking barber's
//      TeamMember.working_hours determine which days are open and the hours.
//   2. ServiceAreas (WHERE) — active zones with enabled priority days
//      determine which zones are displayed for each day (priority label only).
//   3. maxBookingsPerDay (HOW MUCH) — global capacity from GroupDiscountSettings.
//
// Service Zones never determine open/closed dates or working hours.
export function buildDayConfig(barberHours, serviceAreas, maxBookingsPerDay = 8) {
  // 1. Barber working hours = WHEN (source of truth for open/closed + working hours)
  const dayOpen = {};
  const dayClose = {};
  for (const wh of barberHours || []) {
    if (!wh.is_open || wh.open_time == null || wh.close_time == null || wh.close_time <= wh.open_time) continue;
    dayOpen[wh.day_of_week] = wh.open_time;
    dayClose[wh.day_of_week] = wh.close_time;
  }

  // 2. ServiceAreas = WHERE (priority zones only — no times, no capacity)
  const dayZones = {};
  for (const area of serviceAreas || []) {
    if (!area.active) continue;
    for (const d of area.service_days || []) {
      if (!d.enabled) continue;
      const day = d.day_of_week;
      if (!dayZones[day]) dayZones[day] = [];
      dayZones[day].push({ id: area.id, name: area.name || '', colour: area.colour || '#6f22cf', team_member_id: area.team_member_id || null, team_member_name: area.team_member_name || '' });
    }
  }

  // 3. Build periods + capacity from barber working hours + global capacity
  const dayPeriods = {};
  const dayLatestStart = {};
  const dayMaxBookings = {};
  for (const day of Object.keys(dayOpen)) {
    dayPeriods[day] = splitWindowToPeriods(dayOpen[day], dayClose[day]);
    dayLatestStart[day] = decimalToLabel(Math.max(dayOpen[day], dayClose[day] - 1));
    dayMaxBookings[day] = maxBookingsPerDay;
  }

  return {
    dayPeriods,
    dayLatestStart,
    dayMaxBookings,
    dayZones,
    bookableDays: new Set(Object.keys(dayOpen)),
  };
}

// "Tue, Wed & Fri" from a list of full day names (enabled days only).
export function formatDaySummary(days) {
  const list = (days || []).slice();
  if (list.length === 0) return 'No service days';
  if (list.length === 1) return DAY_SHORT[list[0]] || list[0];
  const last = DAY_SHORT[list[list.length - 1]] || list[list.length - 1];
  const rest = list.slice(0, -1).map(d => DAY_SHORT[d] || d).join(', ');
  return `${rest} & ${last}`;
}

// "Usually serviced Tue, Wed & Fri"
export function formatUsuallyServiced(days) {
  return `Usually serviced ${formatDaySummary(days)}`;
}

// ── time input helpers (decimal hour <-> "HH:MM") ──
export function decimalToTimeInput(dec) {
  if (dec == null || isNaN(dec)) return '';
  let h = Math.floor(dec);
  let m = Math.round((dec - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function timeInputToDecimal(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h)) return null;
  return h + (m || 0) / 60;
}

// Build a fresh service_days array (all disabled) for a new area.
export function newServiceDays() {
  return WEEK_DAYS.map(day_of_week => ({
    day_of_week,
    enabled: false,
    open_time: 9,
    close_time: 17,
    max_bookings: 8,
  }));
}