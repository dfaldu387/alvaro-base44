// Time block definitions: start and end in decimal hours (24h)
export const TIME_BLOCK_RANGES = {
  Morning:   { start: 9,  end: 12, label: '9am–12pm' },
  Midday:    { start: 12, end: 15, label: '12pm–3pm' },
  Afternoon: { start: 15, end: 18, label: '3pm–6pm' },
  Evening:   { start: 18, end: 21, label: '6pm–9pm' },
};

// Parse a time string like "5pm", "9:30am", "11am" into decimal hours
function parseTime(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();

  // Handle "anytime" edge cases
  if (str.includes('anytime')) return null;

  const isPm = str.includes('pm');
  const isAm = str.includes('am');
  str = str.replace('pm', '').replace('am', '').trim();

  const parts = str.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] ? parseInt(parts[1], 10) / 60 : 0;

  if (isNaN(hours)) return null;

  if (isPm && hours !== 12) hours += 12;
  if (isAm && hours === 12) hours = 0;

  return hours + minutes;
}

// Parse "5pm–9pm" or "5pm-9pm" or "Anytime after 5pm" into { start, end }
export function parseWindow(windowStr) {
  if (!windowStr) return null;
  const lower = windowStr.toLowerCase();

  // "anytime after Xpm"
  const afterMatch = lower.match(/anytime after (.+)/);
  if (afterMatch) {
    const start = parseTime(afterMatch[1]);
    return start !== null ? { start, end: 24 } : null;
  }

  // "Xam/pm – Yam/pm" with various separators
  const rangeMatch = windowStr.match(/([0-9:]+\s*(?:am|pm))\s*[–\-—to]+\s*([0-9:]+\s*(?:am|pm))/i);
  if (rangeMatch) {
    const start = parseTime(rangeMatch[1]);
    const end = parseTime(rangeMatch[2]);
    if (start !== null && end !== null) return { start, end };
  }

  return null;
}

// Does a window overlap with a time block?
export function windowOverlapsBlock(windowStr, blockName) {
  const window = parseWindow(windowStr);
  if (!window) return false;
  const block = TIME_BLOCK_RANGES[blockName];
  if (!block) return false;
  // Overlap: window starts before block ends AND window ends after block starts
  return window.start < block.end && window.end > block.start;
}

// Get which blocks a window overlaps with
export function getOverlappingBlocks(windowStr) {
  return Object.keys(TIME_BLOCK_RANGES).filter(block => windowOverlapsBlock(windowStr, block));
}

// Given all requests for a day, compute request counts per block
export function computeBlockCounts(dayRequests) {
  const counts = { Morning: 0, Midday: 0, Afternoon: 0, Evening: 0 };
  for (const req of dayRequests) {
    if (req.status === 'declined') continue;
    const overlapping = getOverlappingBlocks(req.availability_window);
    for (const block of overlapping) {
      counts[block]++;
    }
  }
  return counts;
}

// ─── Capacity-based demand (internal — never exposed to clients) ───
export const PERIOD_CAPACITY = 8; // legacy default per-period cap
export const DEFAULT_MAX_BOOKINGS_PER_DAY = 8; // default per-day booking cap

// 4 statuses: available, high_demand, limited, unavailable.
// When `capacity` is provided, thresholds scale to that cap (used for the
// configurable per-day max). Without it, the legacy fixed thresholds apply.
export function countToDemandLevel(count, capacity) {
  if (capacity && capacity > 0) {
    if (count >= capacity) return 'unavailable';
    if (count >= capacity * 0.75) return 'limited';
    if (count >= capacity * 0.5) return 'high_demand';
    return 'available';
  }
  if (count >= PERIOD_CAPACITY) return 'unavailable';
  if (count >= 6) return 'limited';
  if (count >= 3) return 'high_demand';
  return 'available';
}

// Overall day demand = max of its blocks
export function computeDayDemand(dayRequests) {
  const counts = computeBlockCounts(dayRequests);
  const maxCount = Math.max(...Object.values(counts));
  return countToDemandLevel(maxCount);
}

// ─── Per-day booking periods (actual business hours per day) ───
export const DAY_PERIODS = {
  Tuesday:   [{ name: 'Morning', start: 9, end: 12, label: '9am–12pm' }, { name: 'Midday', start: 12, end: 15, label: '12pm–3pm' }, { name: 'Afternoon', start: 15, end: 18, label: '3pm–6pm' }],
  Wednesday: [{ name: 'Morning', start: 9, end: 12, label: '9am–12pm' }, { name: 'Midday', start: 12, end: 15, label: '12pm–3pm' }, { name: 'Afternoon', start: 15, end: 18, label: '3pm–6pm' }],
  Thursday:  [{ name: 'Morning', start: 9, end: 12, label: '9am–12pm' }, { name: 'Midday', start: 12, end: 15, label: '12pm–3pm' }, { name: 'Afternoon', start: 15, end: 18, label: '3pm–6pm' }, { name: 'Evening', start: 18, end: 21, label: '6pm–9pm' }],
  Friday:    [{ name: 'Morning', start: 9, end: 12, label: '9am–12pm' }, { name: 'Midday', start: 12, end: 15, label: '12pm–3pm' }, { name: 'Afternoon', start: 15, end: 18, label: '3pm–6pm' }, { name: 'Evening', start: 18, end: 21, label: '6pm–9pm' }],
  Saturday:  [{ name: 'Morning', start: 7, end: 10, label: '7am–10am' }, { name: 'Midday', start: 10, end: 13, label: '10am–1pm' }, { name: 'Afternoon', start: 13, end: 16, label: '1pm–4pm' }],
};

export const DAY_LATEST_START = {
  Tuesday: '5:30pm', Wednesday: '5:30pm', Thursday: '8:00pm', Friday: '8:00pm', Saturday: '3:00pm',
};

function windowFromRequest(req) {
  const w = parseWindow(req.availability_window);
  if (w) return w;
  if (req.availability_window && req.availability_window.toLowerCase().includes('flex')) return { start: 0, end: 24 };
  return null;
}

// Request counts per period for a specific day, using that day's actual hours
export function computeDayPeriodCounts(day, dayRequests) {
  const periods = DAY_PERIODS[day] || [];
  const counts = {};
  periods.forEach(p => { counts[p.name] = 0; });
  for (const req of dayRequests) {
    if (req.status === 'declined') continue;
    const w = windowFromRequest(req);
    if (!w) continue;
    periods.forEach(p => { if (w.start < p.end && w.end > p.start) counts[p.name]++; });
  }
  return counts;
}

// Overall day demand. When `maxBookingsPerDay` is provided, the status is
// derived from the total number of actual bookings that day (requests, not
// add-ons and not people) against the configurable per-day cap. Without it,
// falls back to the legacy per-period max.
export function dayDemandLevel(day, dayRequests, maxBookingsPerDay) {
  if (maxBookingsPerDay && maxBookingsPerDay > 0) {
    const total = (dayRequests || []).filter(r => r.status !== 'declined').length;
    return countToDemandLevel(total, maxBookingsPerDay);
  }
  const counts = computeDayPeriodCounts(day, dayRequests);
  const vals = Object.values(counts);
  return countToDemandLevel(vals.length ? Math.max(...vals) : 0);
}

// Which periods (by name) a from/until window (decimal hours) overlaps on a day
export function getOverlappingPeriods(day, start, end) {
  return (DAY_PERIODS[day] || []).filter(p => start < p.end && end > p.start).map(p => p.name);
}

// Decimal hours (e.g. 13.5) -> "1:30pm"
export function decimalToLabel(dec) {
  if (dec === null || dec === undefined) return '';
  let h = Math.floor(dec);
  let m = Math.round((dec - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  const ampm = h >= 12 ? 'pm' : 'am';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${String(m).padStart(2, '0')}${ampm}`;
}