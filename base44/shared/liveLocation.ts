import { sydneyClock, LIVE_FIX_MAX_AGE_SECONDS, LIVE_FIX_MAX_ACCURACY_M } from './routeEta.ts';

/**
 * Live barber location: the server-side half. ONE row per barber
 * (BarberLiveLocation), overwritten in place. Never appended, never a trail.
 *
 *   LOOKUP_INTERVAL_SECONDS  a travel-time lookup happens at most this often per
 *                            barber, and only while a stop is on_the_way.
 *   FIX_EXPIRY_SECONDS       a stored position older than this is cleared.
 *   MAX_STRAIGHT_KM          a fix further than this from the stop is dropped
 *                            before any lookup is paid for.
 */
export const LOOKUP_INTERVAL_SECONDS = 120;
export const FIX_EXPIRY_SECONDS = LIVE_FIX_MAX_AGE_SECONDS;
export const MAX_STRAIGHT_KM = 100;

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** Everything on the row that is a position or a measurement from one. */
const NO_FIX = {
  lat: null, lng: null, accuracy_m: null, taken_at: null,
  travel_stop_id: null, travel_checked_at: null, travel_drive_minutes: null, travel_measured_at: null,
};

export const sydneyToday = (now: Date = new Date()) => sydneyClock(now.getTime()).date;

export type FixCheck =
  | { ok: true; fix: { lat: number; lng: number; accuracy_m: number; taken_at: string } }
  | { ok: false; reason: string };

/** Is this a position worth storing at all? A missing or poor position is normal, not an error. */
export function checkFix(body: any, now: Date): FixCheck {
  const lat = Number(body?.lat); const lng = Number(body?.lng); const acc = Number(body?.accuracy_m);
  if (body?.lat == null || body?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, reason: 'no_position' };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return { ok: false, reason: 'no_position' };
  if (!Number.isFinite(acc) || acc <= 0) return { ok: false, reason: 'no_accuracy' };
  if (acc > LIVE_FIX_MAX_ACCURACY_M) return { ok: false, reason: 'low_accuracy' };
  const taken = Date.parse(String(body?.taken_at || ''));
  if (!Number.isFinite(taken)) return { ok: false, reason: 'no_timestamp' };
  const age = now.getTime() - taken;
  if (age > FIX_EXPIRY_SECONDS * 1000) return { ok: false, reason: 'stale' };
  if (age < -60000) return { ok: false, reason: 'bad_timestamp' };
  return { ok: true, fix: { lat, lng, accuracy_m: acc, taken_at: new Date(taken).toISOString() } };
}

export function straightKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when a lookup for this stop was already started inside the interval. */
export function lookupThrottled(row: any, stopId: string, now: Date): boolean {
  if (!row?.travel_checked_at || String(row.travel_stop_id || '') !== stopId) return false;
  const at = Date.parse(String(row.travel_checked_at));
  return Number.isFinite(at) && now.getTime() - at < LOOKUP_INTERVAL_SECONDS * 1000;
}

/** The barber's rows. There should be at most one; any extra is removed so it stays one. */
export async function ownRow(admin: any, memberId: string): Promise<any | null> {
  const rows = asList(await admin.entities.BarberLiveLocation.filter({ team_member_id: memberId }, '-updated_date', 20));
  for (const extra of rows.slice(1)) await admin.entities.BarberLiveLocation.delete(extra.id);
  return rows[0] || null;
}

async function note(admin: any, action: string, summary: string, detail: string, date: string) {
  // The audit row records ONLY that sharing was on or off. Never a position.
  try {
    await admin.entities.ActivityLog.create({
      action, actor: 'barber', summary, detail, schedule_date: date, timestamp: new Date().toISOString(),
    });
  } catch { /* an audit failure never undoes the change */ }
}

export async function logSwitch(admin: any, on: boolean, who: string, date: string, why = '') {
  await note(admin, on ? 'live_location_on' : 'live_location_off', `Live location ${on ? 'on' : 'off'}`,
    [`by ${who}`, why].filter(Boolean).join(' · ').slice(0, 200), date);
}

/** Forget the position (and the measurement taken from it), keep the switch. */
export async function clearFix(admin: any, memberId: string): Promise<boolean> {
  const row = await ownRow(admin, memberId);
  if (!row || row.lat == null) return false;
  await admin.entities.BarberLiveLocation.update(row.id, { ...NO_FIX });
  return true;
}

/** Switch off: the row, and with it any position, is deleted. Returns whether there was one. */
export async function switchOff(admin: any, memberId: string, who: string, why: string): Promise<boolean> {
  const rows = asList(await admin.entities.BarberLiveLocation.filter({ team_member_id: memberId }, '-updated_date', 20));
  for (const r of rows) await admin.entities.BarberLiveLocation.delete(r.id);
  if (rows.length) await logSwitch(admin, false, who, rows[0].service_date || sydneyToday(), why);
  return rows.length > 0;
}

/** Housekeeping for the 5-minute sweep: yesterday's switches are deleted, expired positions cleared. */
export async function purgeExpired(admin: any, now: Date = new Date()): Promise<{ deleted: number; cleared: number }> {
  const out = { deleted: 0, cleared: 0 };
  const today = sydneyToday(now);
  for (const row of asList(await admin.entities.BarberLiveLocation.filter({}, '-updated_date', 200))) {
    if (row.service_date !== today || row.sharing_on !== true) {
      await admin.entities.BarberLiveLocation.delete(row.id); out.deleted++; continue;
    }
    const taken = Date.parse(String(row.taken_at || ''));
    const noOwnerTime = row.lat != null && !Number.isFinite(taken);
    if (noOwnerTime || (Number.isFinite(taken) && now.getTime() - taken > FIX_EXPIRY_SECONDS * 1000)) {
      await admin.entities.BarberLiveLocation.update(row.id, { ...NO_FIX }); out.cleared++;
    }
  }
  return out;
}

/** Counts a paid lookup so the cost is visible. A counter only; no position. */
export async function countLookup(admin: any, memberId: string, date: string, ok: boolean): Promise<void> {
  const rows = asList(await admin.entities.LiveLookupCount.filter({ team_member_id: memberId, service_date: date }, '-created_date', 1));
  if (rows[0]) {
    await admin.entities.LiveLookupCount.update(rows[0].id, { lookups: Number(rows[0].lookups || 0) + 1, failures: Number(rows[0].failures || 0) + (ok ? 0 : 1) });
  } else {
    await admin.entities.LiveLookupCount.create({ team_member_id: memberId, service_date: date, lookups: 1, failures: ok ? 0 : 1 });
  }
}

export async function lookupsToday(admin: any, memberId: string, date: string): Promise<number> {
  try {
    const rows = asList(await admin.entities.LiveLookupCount.filter({ team_member_id: memberId, service_date: date }, '-created_date', 1));
    return Number(rows[0]?.lookups || 0);
  } catch { return 0; }
}

/**
 * The end-of-step hook for advanceRouteStop. Arriving at (or starting, completing,
 * skipping) a stop ends transit, so the position is forgotten; when every stop on
 * the day is completed or skipped the switch itself goes off. Never throws.
 */
export async function afterStepCleanup(admin: any, args: { memberId: string; action: string; stops: any[]; execution: any[]; who: string }) {
  try {
    if (!args.memberId || !['arrive', 'start', 'complete', 'skip'].includes(args.action)) return;
    await clearFix(admin, args.memberId);
    if (args.action !== 'complete' && args.action !== 'skip') return;
    const state = new Map<string, string>((args.execution || []).map((e: any) => [String(e.booking_request_id), String(e.state)]));
    const finished = (args.stops || []).length > 0 && args.stops.every((s: any) => ['completed', 'skipped'].includes(state.get(String(s.booking_request_id)) || 'planned'));
    if (finished) await switchOff(admin, args.memberId, args.who, 'day ended');
  } catch (e) {
    console.error('live location cleanup failed', (e as Error)?.message);
  }
}