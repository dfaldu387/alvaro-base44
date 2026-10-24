// Booking date utilities — the public booking calendar's date range and the
// customer-facing availability statuses.
//
// The booking window itself (minimum notice, maximum horizon) is owned by
// Booking Rules and enforced by the backend: publicBookingData returns exactly
// the dates a customer may book, and submitPublicBooking re-checks on submit.
// Nothing here decides a booking window — these helpers only read what the
// backend returned, so the browser can never be more permissive than the server.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Every bookable date the backend offered, oldest first.
export function allowedDateStrings(daySummaries) {
  return Object.keys(daySummaries || {}).sort();
}

// Turn a YYYY-MM-DD date string from the backend into a local Date.
export function dateFromDateString(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// The first date the customer can actually pick: the first date inside the
// booking window whose weekday the business works (and which is not closed).
export function findFirstBookableDate(bookableDays, daySummaries) {
  const dates = allowedDateStrings(daySummaries);
  if (dates.length === 0) return null;
  for (const dateStr of dates) {
    const date = dateFromDateString(dateStr);
    if (!date) continue;
    const status = daySummaries?.[dateStr]?.customer_status || 'closed';
    if (status === 'closed') continue;
    if (bookableDays && bookableDays.size > 0 && !bookableDays.has(DAY_NAMES[date.getDay()])) continue;
    return date;
  }
  return null;
}

// Customer-facing availability statuses with colour + label.
// The backend computes the authoritative status per date (see publicBookingData
// → daySummaries). The frontend renders these directly — no client-side demand
// calculation.
export const AVAILABILITY_STATUS = {
  available: { dot: 'bg-green-400', label: 'Available', color: 'text-green-400' },
  in_demand: { dot: 'bg-amber-400', label: 'In demand', color: 'text-amber-400' },
  limited: { dot: 'bg-red-400', label: 'Limited spots', color: 'text-red-400' },
  waitlist: { dot: 'bg-purple-500', label: 'Waitlist', color: 'text-purple-400' },
  closed: { dot: 'bg-zinc-500', label: 'Closed', color: 'text-zinc-500' },
};

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ordinalSuffix(d) {
  if (d === 1 || d === 21 || d === 31) return 'st';
  if (d === 2 || d === 22) return 'nd';
  if (d === 3 || d === 23) return 'rd';
  return 'th';
}

/**
 * "Wednesday 21st October" for the date the customer actually chose.
 *
 * This used to take only the WEEKDAY NAME and rebuild a date from it by finding the next such
 * weekday, with `if (diff <= 0) diff += 7`. Every date outside the coming seven days was then shown
 * wrong: today displayed as a week later, and a day chosen two weeks out displayed as next week's.
 * The customer read one date on the Review step and submitted another. The real Date was in scope
 * the whole time, so it is simply formatted here.
 */
export function formatAppointmentDate(date) {
  if (!date) return '';
  const d = date.getDate();
  return `${FULL_DAYS[date.getDay()]} ${d}${ordinalSuffix(d)} ${MONTHS[date.getMonth()]}`;
}

/**
 * "Friday 30th October" from a stored 'YYYY-MM-DD'. Parsed field by field, never with
 * `new Date(string)`, so the day can never shift by a timezone offset.
 * Returns '' for a missing or malformed value, so a flexible booking shows its weekday instead.
 */
export function formatIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  return formatAppointmentDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
