/**
 * Google Calendar as an availability source.
 *
 * Reads the signed-in person's own Google Calendar and keeps ordinary BookingRequest
 * BLOCK rows (the exact shape BlockTimeModal writes) for the time that is genuinely
 * busy. The public form already treats those rows as busy time, so nothing in the
 * shared availability filters changes.
 *
 * Hard rules built in:
 *  - Only block rows this sync made are ever created, updated or deleted. Every write
 *    goes through `ownBlockWriter`, which refuses any row that is not a block tagged
 *    block_source=google_calendar and owned by this user. A real booking, a hand-made
 *    block or another barber's Google block can never be touched, even by a bug.
 *  - No event content is read, stored, logged or returned. Google is asked (via
 *    `fields`) for ids, times, free/busy, the user's own response and the app marker only.
 *  - A failed or partial read keeps the last blocks and marks them stale. It never
 *    deletes and never invents.
 *  - Nothing here sends a message or moves a booking. Conflicts are returned as warnings.
 */

import { isBlockRow, isRouteAppointment } from './routeFingerprint.ts';
import { parseTimeStr } from './provisionalPlacement.ts';
import { nextDateLabel } from './calendarSync.ts';

export const GOOGLE_SOURCE = 'google_calendar';
export const BLOCK_NAME = '[BLOCK] Google Calendar';
export const APP_MARKER_KEY = 'cutdeluxe';
/** Days read ahead. Covers the default 30-day booking window and stays one small request. */
export const WINDOW_DAYS = 30;
export const AUTO_THROTTLE_MINUTES = 15;
export const OUT_OF_DATE_HOURS = 12;
const MAX_PAGES = 4;
const TZ = 'Australia/Sydney';
const API = 'https://www.googleapis.com/calendar/v3';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Ask Google for the least it will give: no titles, descriptions, locations or emails.
const EVENT_FIELDS =
  'summary,nextPageToken,items(id,status,transparency,eventType,start,end,attendees(self,responseStatus),extendedProperties/private)';

const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

// ── Time ──────────────────────────────────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** An instant as Sydney wall-clock: its date and minutes into that day. */
export function sydneyParts(ms: number): { date: string; minutes: number } {
  const p: any = {};
  for (const part of partsFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** 750 → "12:30pm" (the label format BlockTimeModal stores). 1440 reads as "12:00am". */
export function minutesLabel(total: number): string {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

const weekdayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

function addDays(date: string, n: number): string {
  let d = date;
  for (let i = 0; i < n; i++) d = nextDateLabel(d);
  return d;
}

export interface Segment { date: string; start: number; end: number }

/**
 * One segment per calendar day an event covers, clipped to [today, lastDate].
 * Multi-day and overnight events become one block row per day (a row is one date and
 * one time range, exactly like a hand-made block), so a 10pm–2am event blocks
 * 10pm–midnight on day one and midnight–2am on day two. Returns null when the event's
 * times cannot be read.
 */
export function eventSegments(ev: any, today: string, lastDate: string): Segment[] | null {
  const out: Segment[] = [];
  const push = (date: string, start: number, end: number) => {
    if (end > start && date >= today && date <= lastDate) out.push({ date, start, end });
  };
  if (ev?.start?.date && !ev?.start?.dateTime) {
    const first = String(ev.start.date);
    const endExclusive = String(ev.end?.date || nextDateLabel(first));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || endExclusive <= first) return null;
    let d = first;
    for (let i = 0; i < 400 && d < endExclusive; i++, d = nextDateLabel(d)) push(d, 0, 1440);
    return out;
  }
  const s = Date.parse(ev?.start?.dateTime);
  const e = Date.parse(ev?.end?.dateTime);
  if (!isFinite(s) || !isFinite(e) || e <= s) return null;
  const a = sydneyParts(s);
  const b = sydneyParts(e);
  let d = a.date;
  for (let i = 0; i < 400 && d <= b.date; i++, d = nextDateLabel(d)) {
    push(d, d === a.date ? a.minutes : 0, d === b.date ? b.minutes : 1440);
  }
  return out;
}

// ── Which events block ────────────────────────────────────────────────────────

export const isAllDay = (ev: any) => !!ev?.start?.date && !ev?.start?.dateTime;

/** Does this event genuinely occupy him? `why` is a fixed code, never event content. */
export function classifyEvent(ev: any, opts: { includeAllDay: boolean; pushedIds: Set<string> }): { blocks: boolean; why: string } {
  if (!ev?.id) return { blocks: false, why: 'unreadable' };
  if (ev.status === 'cancelled') return { blocks: false, why: 'cancelled' };
  // Events the app wrote itself: the stored event id first (survives edits and drags), the private marker second.
  if (opts.pushedIds.has(String(ev.id))) return { blocks: false, why: 'app_event' };
  if (ev.extendedProperties?.private?.[APP_MARKER_KEY]) return { blocks: false, why: 'app_event' };
  if (ev.transparency === 'transparent') return { blocks: false, why: 'free' };
  if (ev.eventType === 'workingLocation') return { blocks: false, why: 'working_location' };
  if ((ev.attendees || []).some((a: any) => a?.self && a?.responseStatus === 'declined')) return { blocks: false, why: 'declined' };
  if (isAllDay(ev) && !opts.includeAllDay) return { blocks: false, why: 'all_day_off' };
  return { blocks: true, why: 'busy' };
}

// ── Block rows ────────────────────────────────────────────────────────────────

export const isOwnBlock = (row: any, owner: string): boolean =>
  !!row && row.block_source === GOOGLE_SOURCE && row.google_owner_user_id === owner && !!row.google_event_id && isBlockRow(row);

/** The row fields that depend on the event's time, in the shape BlockTimeModal writes. */
function timeFields(seg: Segment) {
  return {
    day: weekdayOf(seg.date),
    requested_date: seg.date,
    availability_window: `${minutesLabel(seg.start)}–${minutesLabel(seg.end)}`,
    assigned_time: minutesLabel(seg.start),
    duration_mins: seg.end - seg.start,
  };
}

/**
 * A personal event blocks only its own barber: the validator ignores a block whose team_member_id is another
 * barber's. A user with no barber profile gets no member id, and then the block (as before) blocks everyone.
 */
const memberField = (memberId: string | null) => (memberId ? { team_member_id: memberId } : {});

function newRow(owner: string, eventId: string, seg: Segment, memberId: string | null = null) {
  return {
    ...memberField(memberId),
    client_name: BLOCK_NAME,
    phone: 'BLOCK',
    services: ['Google Calendar'],
    status: 'confirmed',
    price: 0,
    block_source: GOOGLE_SOURCE,
    google_event_id: eventId,
    google_owner_user_id: owner,
    ...timeFields(seg),
  };
}

const sameTime = (row: any, seg: Segment) => {
  const f = timeFields(seg);
  return row.requested_date === f.requested_date && row.assigned_time === f.assigned_time && Number(row.duration_mins) === f.duration_mins;
};

/**
 * The ONLY door through which the sync writes BookingRequest rows. Anything that is not
 * a Google block row owned by this user throws before a write is attempted.
 */
export function ownBlockWriter(admin: any, owner: string) {
  const table = admin.entities.BookingRequest;
  const refuse = (what: string): never => { throw new Error(`google sync refused to ${what} a row that is not its own block`); };
  return {
    create: (data: any) => {
      if (data?.block_source !== GOOGLE_SOURCE || data?.google_owner_user_id !== owner || !data?.google_event_id || !isBlockRow(data)) refuse('create');
      return table.create(data);
    },
    update: (row: any, patch: any) => {
      if (!isOwnBlock(row, owner)) refuse('update');
      const allowed = new Set(['day', 'requested_date', 'availability_window', 'assigned_time', 'duration_mins', 'team_member_id']);
      if (Object.keys(patch).some((k) => !allowed.has(k))) refuse('update');
      return table.update(row.id, patch);
    },
    delete: (row: any) => {
      if (!isOwnBlock(row, owner)) refuse('delete');
      return table.delete(row.id);
    },
  };
}

/** Every block row this user's sync owns (re-checked in code, whatever the query matched). */
export async function ownBlocks(admin: any, owner: string): Promise<any[]> {
  const found = rowsOf(await admin.entities.BookingRequest.filter(
    { block_source: GOOGLE_SOURCE, google_owner_user_id: owner }, '-created_date', 2000,
  ));
  return found.filter((r) => isOwnBlock(r, owner));
}

// ── State (settings and health, one row per user) ─────────────────────────────

export async function getState(admin: any, userId: string): Promise<any> {
  const found = rowsOf(await admin.entities.CalendarImportState.filter({ user_id: userId }, '-created_date', 1))[0];
  if (found) return found;
  return admin.entities.CalendarImportState.create({
    user_id: userId, enabled: false, include_all_day: false, stale: false, failure_count: 0, consecutive_failures: 0,
  });
}

async function recordFailure(admin: any, state: any, code: string) {
  const patch = {
    last_attempt_at: new Date().toISOString(), stale: true, last_error: code,
    failure_count: (Number(state.failure_count) || 0) + 1,
    consecutive_failures: (Number(state.consecutive_failures) || 0) + 1,
  };
  await admin.entities.CalendarImportState.update(state.id, patch);
  Object.assign(state, patch);
}

// ── The sync ──────────────────────────────────────────────────────────────────

async function readEvents(accessToken: string, now: Date): Promise<{ events: any[]; account: string | null } | { error: string }> {
  const timeMin = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + (WINDOW_DAYS + 2) * 24 * 3600 * 1000).toISOString();
  const events: any[] = [];
  let account: string | null = null;
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${API}/calendars/primary/events?singleEvents=true&orderBy=startTime&showDeleted=false&maxResults=250` +
      `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
      `&fields=${encodeURIComponent(EVENT_FIELDS)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      return { error: 'google_unreachable' };
    }
    if (!res.ok) return { error: res.status === 401 || res.status === 403 ? 'google_refused' : 'google_unreachable' };
    let data: any;
    try { data = await res.json(); } catch { return { error: 'google_unreachable' }; }
    if (page === 0 && typeof data?.summary === 'string' && data.summary.includes('@')) account = data.summary;
    events.push(...(data?.items || []));
    if (!data?.nextPageToken) return { events, account };
    pageToken = data.nextPageToken;
  }
  // More pages than we are willing to read: a partial picture must not be treated as the whole calendar.
  return { error: 'too_many_events' };
}

export interface ImportResult {
  ok: boolean; error?: string; added: number; updated: number; removed: number; held: number; stale: boolean; conflicts?: any[];
}

/**
 * Reads Google once and reconciles this user's own block rows to it.
 * Never throws. On any failure the existing blocks stay and the state is marked stale.
 */
export async function runImport({ admin, accessToken, userId, state, now = new Date(), memberId = null }: {
  admin: any; accessToken: string; userId: string; state: any; now?: Date; memberId?: string | null;
}): Promise<ImportResult> {
  const today = sydneyParts(now.getTime()).date;
  const lastDate = addDays(today, WINDOW_DAYS);
  const startedAt = new Date().toISOString();
  await admin.entities.CalendarImportState.update(state.id, { last_attempt_at: startedAt });
  state.last_attempt_at = startedAt;

  const read = await readEvents(accessToken, now);
  if ('error' in read) {
    await recordFailure(admin, state, read.error);
    return { ok: false, error: read.error, added: 0, updated: 0, removed: 0, held: (await ownBlocks(admin, userId)).filter((r) => r.requested_date >= today).length, stale: true };
  }

  try {
    const pushedIds = new Set<string>(
      rowsOf(await admin.entities.CalendarSync.filter({ app_user_id: userId }, '-created_date', 5000))
        .map((l: any) => String(l.event_id || '')).filter(Boolean),
    );
    const includeAllDay = !!state.include_all_day;

    // Desired blocks: event id → day segments. Unreadable events are protected, not deleted.
    const desired = new Map<string, Segment[]>();
    const protectedIds = new Set<string>();
    let unreadable = 0;
    for (const ev of read.events) {
      const verdict = classifyEvent(ev, { includeAllDay, pushedIds });
      if (!verdict.blocks) {
        if (verdict.why === 'unreadable') unreadable++;
        continue;
      }
      const segs = eventSegments(ev, today, lastDate);
      if (segs == null) { unreadable++; protectedIds.add(String(ev.id)); continue; }
      if (segs.length) desired.set(String(ev.id), segs);
    }

    const writer = ownBlockWriter(admin, userId);
    const mine = (await ownBlocks(admin, userId)).filter((r) => r.requested_date >= today && r.requested_date <= lastDate);
    const byEvent = new Map<string, any[]>();
    for (const r of mine) byEvent.set(r.google_event_id, [...(byEvent.get(r.google_event_id) || []), r]);

    let added = 0, updated = 0, removed = 0, failed = 0;
    const attempt = async (fn: () => Promise<any>, onOk: () => void) => {
      try { await fn(); onOk(); } catch { failed++; }
    };

    for (const [eventId, segs] of desired) {
      const rows = byEvent.get(eventId) || [];
      const used = new Set<any>();
      const unmatched: Segment[] = [];
      for (const seg of segs) {
        const hit = rows.find((r) => !used.has(r) && sameTime(r, seg));
        if (hit) {
          used.add(hit);
          // Blocks made before this rule existed are given their barber on the next sync.
          if (memberId && hit.team_member_id !== memberId) await attempt(() => writer.update(hit, memberField(memberId)), () => { updated++; });
        } else unmatched.push(seg);
      }
      const spare = rows.filter((r) => !used.has(r));
      for (const seg of unmatched) {
        const reuse = spare.shift();
        if (reuse) await attempt(() => writer.update(reuse, { ...timeFields(seg), ...memberField(memberId) }), () => { updated++; });
        else await attempt(() => writer.create(newRow(userId, eventId, seg, memberId)), () => { added++; });
      }
      for (const extra of spare) await attempt(() => writer.delete(extra), () => { removed++; });
    }
    // An event that is gone from Google, or no longer blocks (free, declined, cancelled, all-day off): its rows go.
    for (const [eventId, rows] of byEvent) {
      if (desired.has(eventId) || protectedIds.has(eventId)) continue;
      for (const row of rows) await attempt(() => writer.delete(row), () => { removed++; });
    }

    const held = (await ownBlocks(admin, userId)).filter((r) => r.requested_date >= today).length;
    const clean = failed === 0 && unreadable === 0;
    const patch: any = {
      last_attempt_at: startedAt, last_added: added, last_updated: updated, last_removed: removed,
      ...(read.account ? { google_account: read.account } : {}),
    };
    if (clean) Object.assign(patch, { stale: false, last_error: null, consecutive_failures: 0, last_success_at: new Date().toISOString() });
    else Object.assign(patch, { stale: true, last_error: 'partial', failure_count: (Number(state.failure_count) || 0) + 1, consecutive_failures: (Number(state.consecutive_failures) || 0) + 1 });
    await admin.entities.CalendarImportState.update(state.id, patch);
    Object.assign(state, patch);

    const conflicts = await findConflicts(admin, userId, memberId, today);
    return { ok: clean, error: clean ? undefined : 'partial', added, updated, removed, held, stale: !clean, conflicts };
  } catch {
    await recordFailure(admin, state, 'partial');
    return { ok: false, error: 'partial', added: 0, updated: 0, removed: 0, held: 0, stale: true };
  }
}

/** Switch off: remove every block this sync created for the user. Hand-made blocks and bookings are never listed. */
export async function removeAllOwnBlocks(admin: any, userId: string): Promise<number> {
  const writer = ownBlockWriter(admin, userId);
  let removed = 0;
  for (const row of await ownBlocks(admin, userId)) {
    await writer.delete(row);
    removed++;
  }
  return removed;
}

// ── Conflicts: warnings only ──────────────────────────────────────────────────

const DEAD = ['declined', 'no_show', 'could_not_fit', 'blocked', 'completed', 'rescheduled'];

/**
 * Where a Google block overlaps a real Cut Deluxe appointment. Read-only: it changes
 * nothing, and it names the appointment and the time so he can decide.
 */
export async function findConflicts(admin: any, userId: string, memberId: string | null, today: string): Promise<any[]> {
  const blocks = (await ownBlocks(admin, userId)).filter((b) => b.requested_date >= today);
  if (!blocks.length) return [];
  const dates = [...new Set(blocks.map((b) => b.requested_date))];
  const appts = rowsOf(await admin.entities.BookingRequest.filter({ requested_date: { $in: dates } }, '-created_date', 2000))
    .filter((a: any) => dates.includes(a.requested_date) && !isBlockRow(a) && isRouteAppointment(a) && !DEAD.includes(a.status))
    .filter((a: any) => !memberId || !a.team_member_id || a.team_member_id === memberId);

  const out: any[] = [];
  for (const b of blocks) {
    const bs = parseTimeStr(String(b.assigned_time || ''));
    if (!isFinite(bs)) continue;
    const be = bs + (Number(b.duration_mins) || 0) / 60;
    for (const a of appts) {
      if (a.requested_date !== b.requested_date) continue;
      const as = parseTimeStr(String(a.assigned_time || ''));
      if (!isFinite(as)) continue;
      const ae = as + (Number(a.duration_mins) || 30) / 60;
      if (as < be && ae > bs) {
        out.push({
          booking_id: a.id, client_name: a.client_name || 'An appointment', date: a.requested_date,
          starts: minutesLabel(as * 60), ends: minutesLabel(ae * 60),
        });
      }
    }
  }
  return out.sort((x, y) => (x.date + x.starts).localeCompare(y.date + y.starts)).slice(0, 10);
}

/** The status the card shows, built from stored state only (no Google call). */
export async function importSummary(admin: any, userId: string, memberId: string | null, now = new Date()) {
  const state = await getState(admin, userId);
  const today = sydneyParts(now.getTime()).date;
  const held = state.enabled ? (await ownBlocks(admin, userId)).filter((r) => r.requested_date >= today).length : 0;
  const last = state.last_success_at ? Date.parse(state.last_success_at) : NaN;
  const hoursOld = isFinite(last) ? (now.getTime() - last) / 3600000 : null;
  return {
    enabled: !!state.enabled,
    include_all_day: !!state.include_all_day,
    account: state.google_account || null,
    last_success_at: state.last_success_at || null,
    last_attempt_at: state.last_attempt_at || null,
    blocks_held: held,
    stale: !!state.stale,
    out_of_date: !!state.enabled && (hoursOld == null || hoursOld > OUT_OF_DATE_HOURS),
    failure_count: Number(state.failure_count) || 0,
    last_error: state.last_error || null,
    conflicts: state.enabled ? await findConflicts(admin, userId, memberId, today) : [],
  };
}

/** True when an automatic run is still inside the throttle window. */
export function throttled(state: any, now = new Date()): boolean {
  const last = state?.last_attempt_at ? Date.parse(state.last_attempt_at) : NaN;
  return isFinite(last) && now.getTime() - last < AUTO_THROTTLE_MINUTES * 60000;
}