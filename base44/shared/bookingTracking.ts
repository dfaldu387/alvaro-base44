import type { RouteEta } from './routeEta.ts';
import { deriveCustomerState } from './customerStopState.ts';

/**
 * Customer tracking links. A booking carries a short unguessable token, valid
 * only on the booking's own date. The public endpoint returns a FIXED, tiny view
 * (see buildTrackingView) and a single neutral answer for every kind of invalid
 * link, so a token can never be used to learn anything else.
 */

/** 16 random bytes -> 22 URL-safe characters (128 bits). */
const TOKEN_BYTES = 16;
export const MIN_TOKEN_LENGTH = 16;

/** The one answer for an unknown, wrong-date, closed or malformed link. */
export const EXPIRED_MESSAGE = 'This link is not active. Live tracking is only available on the day of your appointment.';
export const EXPIRED_RESPONSE = { available: false, message: EXPIRED_MESSAGE } as const;

export function newTrackingToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const isTokenShape = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);

/** Does this booking already hold a token for its CURRENT date? */
export const hasCurrentToken = (b: any): boolean =>
  isTokenShape(b?.tracking_token) && !!b?.requested_date && b.tracking_token_date === b.requested_date;

/** The fields to write when a booking needs a (new) token. Null when it already has a valid one or has no date. */
export function trackingTokenFields(b: any): { tracking_token: string; tracking_token_date: string } | null {
  if (!b?.requested_date || hasCurrentToken(b)) return null;
  return { tracking_token: newTrackingToken(), tracking_token_date: b.requested_date };
}

/** Mint a token if the booking lacks one for its current date. Returns the token, or null. */
export async function ensureTrackingToken(admin: any, booking: any): Promise<string | null> {
  if (hasCurrentToken(booking)) return booking.tracking_token;
  const fields = trackingTokenFields(booking);
  if (!fields) return null;
  await admin.entities.BookingRequest.update(booking.id, fields);
  return fields.tracking_token;
}

const DEFAULT_BASE = 'https://cut-deluxe.base44.app';

/** The site the link points at: the origin of the business's own configured booking link, else the published app. */
export async function trackingBase(admin: any): Promise<string> {
  try {
    const res = await admin.entities.MessagingSettings.list('-created_date', 1);
    const row = (Array.isArray(res) ? res : res?.items || [])[0];
    const link = String(row?.campaign_booking_link || '').trim();
    if (/^https:\/\//i.test(link)) return new URL(link).origin;
  } catch { /* fall through to the published app */ }
  return DEFAULT_BASE;
}

/** The template variable: a full sentence with the link, or '' when none can be made. Never throws. */
export async function trackingLinkVariable(admin: any, booking: any): Promise<string> {
  try {
    const token = await ensureTrackingToken(admin, booking);
    if (!token) return '';
    return `Track your barber live: ${await trackingBase(admin)}/status/${token}`;
  } catch (e) {
    console.error('tracking link failed', (e as Error)?.message);
    return '';
  }
}

const CLOSED = ['declined', 'cancelled', 'no_show', 'could_not_fit', 'blocked'];

/**
 * Is this link live? It must match a booking, be the token minted for the
 * booking's current date, be used on that date (Sydney), and the booking must
 * not be closed. Anything else is "not active" - and the caller cannot tell why.
 */
export function trackingIsLive(booking: any, token: string, todaySydney: string): boolean {
  if (!booking || !isTokenShape(token)) return false;
  if (booking.tracking_token !== token) return false;
  if (!booking.requested_date || booking.tracking_token_date !== booking.requested_date) return false;
  if (booking.requested_date !== todaySydney) return false;
  if (CLOSED.includes(String(booking.status))) return false;
  return true;
}

export interface TrackingView {
  available: true;
  first_name: string;
  service: string;
  booked_time: string | null;
  arrival_window: string | null;
  state: string;
  stops_away: number | null;
}

const DONE = ['completed', 'skipped'];
const NO_WINDOW = ['arrived', 'in_service', 'completed', 'skipped'];

/**
 * The ONLY thing a tracking token can return: first name, service, booked time,
 * live arrival window, the stop's state, and how many stops away the barber is.
 * No address, phone, other bookings, barber position or route.
 */
export function buildTrackingView(booking: any, etaResults: RouteEta[], now: Date = new Date()): TrackingView {
  const id = String(booking.id);
  const route = etaResults.find(r => r.status === 'ok' && r.stops.some(s => s.booking_request_id === id))
    || etaResults.find(r => r.stops.some(s => s.booking_request_id === id))
    || null;
  const stop = route?.stops.find(s => s.booking_request_id === id) || null;

  // The stored state, unless the live ETA supports one of the two customer-only labels (never stored).
  const stored = stop ? stop.state : booking.status === 'completed' ? 'completed' : 'planned';
  const state = deriveCustomerState(stop, route, now.getTime()) || stored;
  const withEta = route?.status === 'ok' && stop && !NO_WINDOW.includes(stop.state);
  const stopsAway = route && stop
    ? route.stops.filter(s => s.order < stop.order && !DONE.includes(s.state)).length
    : null;

  return {
    available: true,
    first_name: String(booking.client_name || '').trim().split(/\s+/)[0] || '',
    service: (Array.isArray(booking.services) ? booking.services : []).filter(Boolean).join(', '),
    booked_time: stop?.planned_start_label || String(booking.assigned_time || '').trim() || null,
    arrival_window: withEta ? stop!.window_label : null,
    state,
    stops_away: stopsAway,
  };
}