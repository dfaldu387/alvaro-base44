/**
 * clientSignals — client-level signals shown on the calendar.
 *
 * Favourite lives on the client record (ReminderClient.is_favourite) and is the
 * single source of truth. NEW is derived from booking history:
 *
 *   isNewClient = real client AND no completed appointment yet
 *                 AND this booking is their first booking
 *
 * Once a client's first service is completed they are never NEW again. Test
 * clients and test bookings never qualify as new.
 */

const norm = (s) => (s || '').toLowerCase().trim();

/** The calendar date a booking belongs to (its scheduled date, else when it was touched). */
const bookingDate = (b) => b.requested_date || (b.updated_date || b.created_date || '').slice(0, 10) || '';

/**
 * Builds a lookup of per-client signals keyed by normalised client name — the
 * same link the rest of the app uses between bookings and client records.
 * Bookings without a client record still get a signal (so first-time clients
 * that haven't been saved as a client yet can still show NEW).
 */
export function buildClientSignals(clients = [], bookings = []) {
  const clientsByName = new Map();
  clients.forEach(c => {
    const k = norm(c.client_name);
    if (k && !clientsByName.has(k)) clientsByName.set(k, c);
  });

  const bookingsByName = new Map();
  bookings.forEach(b => {
    const k = norm(b.client_name);
    if (!k) return;
    if (!bookingsByName.has(k)) bookingsByName.set(k, []);
    bookingsByName.get(k).push(b);
  });

  const keys = new Set([...clientsByName.keys(), ...bookingsByName.keys()]);
  const signals = new Map();

  keys.forEach(key => {
    const list = bookingsByName.get(key) || [];
    const client = clientsByName.get(key) || null;
    const completed = list.filter(b => b.status === 'completed');
    const firstCompletedDate = completed.map(bookingDate).filter(Boolean).sort()[0] || null;

    // The earliest booking carries the NEW badge until the first service is completed.
    let firstBookingId = null;
    let firstDate = null;
    list.forEach(b => {
      const d = bookingDate(b);
      if (!d) return;
      if (firstDate === null || d < firstDate) { firstDate = d; firstBookingId = b.id; }
    });

    signals.set(key, {
      clientId: client?.id || null,
      isFavourite: client?.is_favourite === true,
      isTest: client ? client.is_test === true : false,
      completedCount: completed.length,
      firstCompletedDate,
      firstBookingId,
    });
  });

  return { lookup: (name) => signals.get(norm(name)) || null };
}

/** NEW for this specific booking. */
export function isNewClientBooking(requestId, isTest, sig) {
  if (!sig || !requestId) return false;
  if (isTest === true || sig.isTest) return false;
  if (sig.completedCount > 0) return false;
  return sig.firstBookingId === requestId;
}

/**
 * New clients this month — unique real clients whose FIRST completed
 * appointment falls inside the given month (YYYY-MM). Cancelled and no-show
 * bookings are excluded (only completed services count), each client counts
 * once, and test data is never included.
 */
export function countNewClientsInMonth(bookings = [], signals, monthPrefix) {
  if (!signals || !monthPrefix) return 0;
  const counted = new Set();
  bookings.forEach(b => {
    if (b.status !== 'completed' || b.is_test === true) return;
    const key = norm(b.client_name);
    if (!key || counted.has(key)) return;
    const sig = signals.lookup(b.client_name);
    if (!sig || sig.isTest) return;
    if (!sig.firstCompletedDate || !sig.firstCompletedDate.startsWith(monthPrefix)) return;
    counted.add(key);
  });
  return counted.size;
}