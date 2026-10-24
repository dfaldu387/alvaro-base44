import { parseTimeStr } from './provisionalPlacement.ts';

/**
 * Public-booking day rules, in one place so the booking page and the submit endpoint agree.
 *
 *  1. Capacity: a day with `max_bookings_per_day` or more confirmed/completed bookings is full.
 *     The count is the one the page has always used (status confirmed|completed on that date).
 *  2. Room: even under the count, a day is only offered when a gap in the barber's working hours could hold the
 *     shortest service plus its buffer and a travel allowance on each side that touches another booking.
 *
 * Pure arithmetic on rows the page load has already read: no extra query, no travel-time lookup.
 * Both rules can only CLOSE a day. Nothing here ever opens one the count rule would close.
 */
export const TRAVEL_ALLOWANCE_MIN = 10;
const COUNTED = ['confirmed', 'completed'];

export const capacityLimit = (settings: any): number => settings?.max_bookings_per_day || 8;

export function confirmedOnDate(rows: any[], date: string): number {
  return (rows || []).filter((b) => b.requested_date === date && COUNTED.includes(b.status)).length;
}

export function isAtCapacity(confirmed: number, max: number): boolean {
  return max > 0 && confirmed >= max;
}

/** What the server records as the day's status at submission. Never read from the browser. */
export function serverCapacityStatus(confirmed: number, max: number): 'waitlist' | 'limited' | 'available' {
  if (isAtCapacity(confirmed, max)) return 'waitlist';
  return confirmed >= max * 0.75 ? 'limited' : 'available';
}

export interface Occupied { start: number; end: number }

/** Timed, dated, confirmed/completed bookings on one date that hold this barber's time. Unassigned ones hold everyone's. */
export function occupiedOn(rows: any[], date: string, barberId: string | null): Occupied[] {
  const out: Occupied[] = [];
  for (const b of rows || []) {
    if (b.requested_date !== date || !COUNTED.includes(b.status) || !b.assigned_time) continue;
    if (barberId && b.team_member_id && b.team_member_id !== barberId) continue;
    const start = parseTimeStr(String(b.assigned_time));
    if (!Number.isFinite(start)) continue;
    out.push({ start, end: start + (Number(b.duration_mins) || 30) / 60 });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** True when some gap between open and close can hold a job of `needMins` (plus travel beside any neighbour). */
export function dayHasRoom(open: number, close: number, busy: Occupied[], needMins: number, travelMin = TRAVEL_ALLOWANCE_MIN): boolean {
  if (!(close > open)) return false;
  if (!(needMins > 0)) return true; // no service to size against: do not close on a guess
  let cursor = open;
  let leftNeighbour = false;
  for (const b of busy) {
    if (b.end <= cursor) { leftNeighbour = true; continue; }
    const gapMins = (Math.min(b.start, close) - cursor) * 60 - (leftNeighbour ? travelMin : 0) - travelMin;
    if (b.start > cursor && gapMins >= needMins) return true;
    cursor = Math.max(cursor, b.end);
    leftNeighbour = true;
    if (cursor >= close) return false;
  }
  return (close - cursor) * 60 - (leftNeighbour ? travelMin : 0) >= needMins;
}