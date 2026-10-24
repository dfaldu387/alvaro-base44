import { minutesFromStored, type GuardContext } from './assistantGuard.ts';
import { sydneyNow, addDays, RESOLVED } from './arrivalTimes.ts';

/**
 * The context pack: the ONLY facts the assistant may know about a conversation.
 * Built from stored records, never from the inbound text.
 *
 * Deliberately NOT in the pack: another customer, a street address (suburb only),
 * the day's route or other bookings, any phone number, anything marked test data.
 * A time appears only when it was communicated to the customer (the booking is
 * `confirmed`); until then the customer has a window, and only the window.
 */

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
/** Weekday name of a YYYY-MM-DD date (calendar arithmetic, no time zone involved). */
const weekdayName = (ymd: string) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

export interface PackBooking {
  date: string;
  weekday: string;
  status: string;
  schedule_status: string;
  /** Present only once the time has been confirmed with the customer. */
  booked_time: string | null;
  availability_window: string | null;
  services: string[];
  price: number | null;
  payment_status: string | null;
  /** Today's route state for this booking (e.g. finalised), or null. */
  route_status: string | null;
  /** The customer-facing live state for this booking's own stop, today only. */
  live_state: string | null;
}

export interface AssistantPack {
  kind: 'known_client' | 'new_lead';
  first_name: string | null;
  suburb: string | null;
  history: { visits_completed: number; last_visit_date: string | null; usual_service: string | null; frequency: string | null } | null;
  next_booking: PackBooking | null;
  services: { name: string; price: number | null; duration_mins: number | null }[];
  addons: { name: string; price: number | null; variable_price: boolean }[];
  coverage_areas: string[];
  /** New leads only: what still needs collecting before a booking can be made. */
  still_to_collect: string[];
  booking_link: string | null;
}

const NEW_LEAD_NEEDS = ['their name', 'their suburb or address', 'the service they want', 'the days and times they are free'];

async function catalogue(admin: any) {
  const [services, addons, areas] = await Promise.all([
    admin.entities.Service.filter({ is_active: true }, 'sort_order', 50),
    admin.entities.AddOn.list('-created_date', 100),
    admin.entities.ServiceArea.filter({ active: true }, 'sort_order', 50),
  ]);
  return {
    services: asList(services).filter(s => s.show_on_website !== false).map(s => ({
      name: String(s.name || ''), price: money(s.price), duration_mins: typeof s.duration_mins === 'number' ? s.duration_mins : null,
    })),
    addons: asList(addons).filter(a => a.is_active !== false).map(a => ({
      name: String(a.name || ''), price: money(a.price_adjustment), variable_price: a.variable_price === true,
    })),
    coverage_areas: asList(areas).map(a => String(a.name || '')).filter(Boolean),
  };
}

async function nextBooking(admin: any, client: any, today: string): Promise<{ pack: PackBooking; raw: any } | null> {
  const rows = asList(await admin.entities.BookingRequest.filter(
    { client_id: client.id, requested_date: { $gte: today } }, 'requested_date', 20,
  )).filter(b =>
    b.is_test !== true && !RESOLVED.includes(String(b.status)) && !String(b.client_name || '').startsWith('[BLOCK]') && b.requested_date);
  rows.sort((a, b) => String(a.requested_date).localeCompare(String(b.requested_date)));
  const b = rows[0];
  if (!b) return null;

  let route_status: string | null = null;
  let live_state: string | null = null;
  try {
    const routes = asList(await admin.entities.DayRoute.filter({ date: b.requested_date, is_test: false }, 'created_date', 5));
    const route = routes[0];
    route_status = route?.route_status || null;
    if (route && b.requested_date === today) {
      const mine = (route.stop_execution || []).find((e: any) => e.booking_request_id === b.id);
      live_state = mine?.customer_state || null;
    }
  } catch { /* no route data is simply no route facts */ }

  const communicated = b.schedule_status === 'confirmed' && !!b.assigned_time;
  return {
    raw: b,
    pack: {
      date: b.requested_date,
      weekday: weekdayName(b.requested_date),
      status: String(b.status || ''),
      schedule_status: String(b.schedule_status || ''),
      booked_time: communicated ? String(b.assigned_time) : null,
      availability_window: b.availability_window ? String(b.availability_window) : null,
      services: Array.isArray(b.services) ? b.services.map(String) : [],
      price: money(b.price),
      payment_status: b.payment_status ? String(b.payment_status) : null,
      route_status,
      live_state,
    },
  };
}

export async function buildContextPack(admin: any, client: any | null, now: Date = new Date(), bookingLink: string | null = null): Promise<{ pack: AssistantPack; bookingId: string | null }> {
  const cat = await catalogue(admin);
  if (!client) {
    return {
      bookingId: null,
      pack: { kind: 'new_lead', first_name: null, suburb: null, history: null, next_booking: null, ...cat, still_to_collect: NEW_LEAD_NEEDS, booking_link: bookingLink },
    };
  }
  const today = sydneyNow(now).date;
  const next = await nextBooking(admin, client, today);
  let visits = 0;
  try { visits = Number(await admin.entities.BookingRequest.count({ client_id: client.id, status: 'completed', is_test: { $ne: true } })) || 0; } catch { visits = 0; }
  return {
    bookingId: next?.raw.id || null,
    pack: {
      kind: 'known_client',
      first_name: String(client.client_name || '').trim().split(/\s+/)[0] || null,
      suburb: client.suburb ? String(client.suburb) : (next?.raw.address_suburb ? String(next.raw.address_suburb) : null),
      history: {
        visits_completed: visits,
        last_visit_date: client.last_visit_date || null,
        usual_service: client.usual_service || null,
        frequency: client.frequency || null,
      },
      next_booking: next?.pack || null,
      ...cat,
      still_to_collect: [],
      booking_link: bookingLink,
    },
  };
}

/** What the guard checks a draft against. Times come only from the pack's scheduling data. */
export function guardContextFor(pack: AssistantPack, now: Date = new Date()): GuardContext {
  const minutes = new Set<number>();
  const b = pack.next_booking;
  if (b?.booked_time) {
    const m = minutesFromStored(b.booked_time);
    if (m !== null) minutes.add(m);
  }
  // The customer's own availability window is deliberately NOT allowed: it is what they
  // asked for, not a time the scheduling engine offered, so it must never be echoed back.
  const prices: number[] = [];
  for (const s of pack.services) if (s.price !== null) prices.push(s.price);
  for (const a of pack.addons) if (a.price !== null) prices.push(a.price);
  if (b?.price !== null && b?.price !== undefined) prices.push(b.price);

  const today = sydneyNow(now).date;
  return {
    allowedMinutes: minutes,
    allowedPrices: prices,
    days: {
      weekdays: b ? [b.weekday.toLowerCase()] : [],
      isToday: !!b && b.date === today,
      isTomorrow: !!b && b.date === addDays(today, 1),
    },
  };
}