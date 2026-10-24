// Google Calendar as an availability source: classification, block rows, idempotence, failure, conflicts,
// and above all that the sync only ever touches its own block rows. No network, no real database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadEntry, makeLooseDb } from './helpers/loadEntry.mjs';

const G = await import('../base44/shared/googleBusyImport.ts');
const { blocksTimeSlot, BLOCKING_STATUSES } = await import('../base44/shared/publicBusyBookings.ts');
const { isBlockRow } = await import('../base44/shared/routeFingerprint.ts');

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const NOW = new Date('2026-10-14T00:00:00Z'); // Sydney: Wed 14 Oct 2026, 11:00 (UTC+11)
const USER = 'u1';
const SECRET = 'Dad Birthday SECRET-TITLE';

const ev = (id, start, end, extra = {}) => ({
  id, status: 'confirmed',
  start: { dateTime: `${start}+11:00` }, end: { dateTime: `${end}+11:00` },
  // Even if Google sent content, none of it may land anywhere.
  summary: SECRET, description: 'SECRET-DESC', location: 'SECRET-PLACE', organizer: { email: 'secret@x.test' },
  ...extra,
});
const allDay = (id, d1, d2, extra = {}) => ({ id, status: 'confirmed', start: { date: d1 }, end: { date: d2 }, summary: SECRET, ...extra });

let google; let fetchUrls;
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  fetchUrls = [];
  google = { status: 200, pages: [[]], throws: false, account: 'owner@gmail.test' };
  globalThis.fetch = async (url) => {
    fetchUrls.push(String(url));
    if (google.throws) throw new Error(`network down ${SECRET}`);
    if (google.status !== 200) return { ok: false, status: google.status, json: async () => ({ error: { message: SECRET } }) };
    const idx = String(url).includes('pageToken=') ? Number(new URL(url).searchParams.get('pageToken')) : 0;
    const items = google.pages[idx] || [];
    return { ok: true, status: 200, json: async () => ({ summary: google.account, items, ...(idx + 1 < google.pages.length ? { nextPageToken: String(idx + 1) } : {}) }) };
  };
});
test.after(() => { globalThis.fetch = realFetch; });

const hand = { id: 'hand1', client_name: '[BLOCK] Lunch', phone: 'BLOCK', status: 'confirmed', requested_date: '2026-10-15', assigned_time: '12:00pm', duration_mins: 60, day: 'Thursday' };
const real = { id: 'real1', client_name: 'Jane Smith', status: 'confirmed', requested_date: '2026-10-15', assigned_time: '2:00pm', duration_mins: 60, day: 'Thursday', team_member_id: 't1', google_event_id: 'ev-x' };
const otherUsers = { id: 'g-other', client_name: G.BLOCK_NAME, phone: 'BLOCK', status: 'confirmed', requested_date: '2026-10-16', assigned_time: '9:00am', duration_mins: 60, day: 'Friday', block_source: G.GOOGLE_SOURCE, google_owner_user_id: 'u2', google_event_id: 'ev-other' };
const taggedButNotBlock = { id: 'sneaky', client_name: 'Real Client', status: 'confirmed', requested_date: '2026-10-15', assigned_time: '4:00pm', duration_mins: 30, day: 'Thursday', block_source: G.GOOGLE_SOURCE, google_owner_user_id: USER, google_event_id: 'ev-sneaky' };

function setup({ include_all_day = false, seed = {}, withForeign = true } = {}) {
  const db = makeLooseDb({
    BookingRequest: withForeign ? [{ ...hand }, { ...real }, { ...otherUsers }, { ...taggedButNotBlock }] : [],
    CalendarImportState: [{ id: 's1', user_id: USER, enabled: true, include_all_day, stale: false, failure_count: 0, consecutive_failures: 0 }],
    ...seed,
  });
  return db;
}
const stateOf = (db) => db.tables.CalendarImportState[0];
const mine = (db) => db.tables.BookingRequest.filter((r) => r.block_source === G.GOOGLE_SOURCE && r.google_owner_user_id === USER && isBlockRow(r));
const run = (db, extra = {}) => G.runImport({ admin: db.asServiceRole, accessToken: 'tok', userId: USER, state: stateOf(db), now: NOW, ...extra });
const FOREIGN = ['hand1', 'real1', 'g-other', 'sneaky'];

// ── Which events block ───────────────────────────────────────────────────────────────────────
test('a free/transparent event does not block', async () => {
  const db = setup();
  google.pages = [[ev('e1', '2026-10-15T10:00:00', '2026-10-15T11:00:00', { transparency: 'transparent' })]];
  const r = await run(db);
  assert.equal(r.ok, true);
  assert.equal(mine(db).length, 0);
});

test('a declined event, a cancelled event and a working-location marker do not block', async () => {
  const db = setup();
  google.pages = [[
    ev('declined', '2026-10-15T10:00:00', '2026-10-15T11:00:00', { attendees: [{ self: true, responseStatus: 'declined' }] }),
    ev('cancelled', '2026-10-15T11:00:00', '2026-10-15T12:00:00', { status: 'cancelled' }),
    ev('wl', '2026-10-15T12:00:00', '2026-10-15T13:00:00', { eventType: 'workingLocation' }),
    ev('accepted', '2026-10-15T13:00:00', '2026-10-15T14:00:00', { attendees: [{ self: true, responseStatus: 'accepted' }, { responseStatus: 'declined' }] }),
  ]];
  await run(db);
  assert.deepEqual(mine(db).map((r) => r.google_event_id), ['accepted']);
});

test('an all-day event does not block with the setting off, and blocks that whole day with it on', async () => {
  const off = setup();
  google.pages = [[allDay('bday', '2026-10-17', '2026-10-18')]];
  await run(off);
  assert.equal(mine(off).length, 0);

  const on = setup({ include_all_day: true });
  await run(on);
  const rows = mine(on);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].requested_date, rows[0].assigned_time, rows[0].duration_mins, rows[0].day], ['2026-10-17', '12:00am', 1440, 'Saturday']);

  // Switching the setting off again removes it on the next sync.
  stateOf(on).include_all_day = false;
  await run(on);
  assert.equal(mine(on).length, 0);
});

test('an event the app pushed is skipped: by stored event id (even after he edited it) and by the private marker', async () => {
  const db = setup({ seed: { CalendarSync: [{ id: 'cs1', app_user_id: USER, booking_request_id: 'real1', event_id: 'pushed-1' }] } });
  google.pages = [[
    ev('pushed-1', '2026-10-15T14:00:00', '2026-10-15T15:00:00'),
    ev('marked', '2026-10-15T15:00:00', '2026-10-15T16:00:00', { extendedProperties: { private: { cutdeluxe: 'route-block' } } }),
    ev('his-own', '2026-10-15T16:00:00', '2026-10-15T17:00:00'),
  ]];
  await run(db);
  assert.deepEqual(mine(db).map((r) => r.google_event_id), ['his-own']);
});

test('the route push now tags its events with the private marker', async () => {
  const { calendarEventFor } = await import('../base44/shared/calendarSync.ts');
  const e = calendarEventFor({ booking: { client_name: 'A', duration_mins: 30 }, stop: { start_decimal: 9 }, date: '2026-10-15' });
  assert.equal(e.extendedProperties.private.cutdeluxe, 'route-block');
});

// ── The block row ────────────────────────────────────────────────────────────────────────────
test('a busy event becomes a block row in exactly the BlockTimeModal shape, with no event content', async () => {
  const db = setup();
  google.pages = [[ev('e1', '2026-10-15T14:30:00', '2026-10-15T16:00:00')]];
  await run(db);
  const [row] = mine(db);
  assert.equal(row.client_name, '[BLOCK] Google Calendar');
  assert.deepEqual(
    [row.phone, row.status, row.requested_date, row.assigned_time, row.duration_mins, row.price, row.day, row.availability_window],
    ['BLOCK', 'confirmed', '2026-10-15', '2:30pm', 90, 0, 'Thursday', '2:30pm–4:00pm'],
  );
  assert.deepEqual([row.block_source, row.google_event_id, row.google_owner_user_id], ['google_calendar', 'e1', USER]);
  assert.equal(isBlockRow(row), true);
  // The public form reads it as busy time through the unchanged filter.
  assert.equal(blocksTimeSlot(row), true);
  assert.deepEqual(BLOCKING_STATUSES, ['confirmed', 'completed']);
});

test('re-running the sync updates rather than duplicates; an event moved to another day keeps its single row', async () => {
  const db = setup();
  google.pages = [[ev('e1', '2026-10-15T14:00:00', '2026-10-15T15:00:00')]];
  await run(db); await run(db); await run(db);
  assert.equal(mine(db).length, 1);
  const id = mine(db)[0].id;

  const writesBefore = db.writes.length;
  const again = await run(db);
  assert.deepEqual([again.added, again.updated, again.removed], [0, 0, 0], 'an unchanged event writes nothing');
  assert.equal(db.writes.filter((w) => w.entity === 'BookingRequest').length, writesBefore - db.writes.slice(0, writesBefore).filter((w) => w.entity !== 'BookingRequest').length);

  google.pages = [[ev('e1', '2026-10-16T09:00:00', '2026-10-16T09:30:00')]]; // dragged in Google
  const moved = await run(db);
  assert.equal(mine(db).length, 1);
  assert.equal(mine(db)[0].id, id, 'same row');
  assert.deepEqual([mine(db)[0].requested_date, mine(db)[0].assigned_time, mine(db)[0].duration_mins, mine(db)[0].day], ['2026-10-16', '9:00am', 30, 'Friday']);
  assert.equal(moved.updated, 1);
});

test('an event deleted in Google removes its block, and so does one that stopped blocking', async () => {
  const db = setup();
  google.pages = [[ev('a', '2026-10-15T10:00:00', '2026-10-15T11:00:00'), ev('b', '2026-10-15T12:00:00', '2026-10-15T13:00:00'), ev('c', '2026-10-15T14:00:00', '2026-10-15T15:00:00')]];
  await run(db);
  assert.equal(mine(db).length, 3);
  google.pages = [[
    ev('b', '2026-10-15T12:00:00', '2026-10-15T13:00:00', { transparency: 'transparent' }), // switched to free
    // a: deleted in Google; c: declined
    ev('c', '2026-10-15T14:00:00', '2026-10-15T15:00:00', { attendees: [{ self: true, responseStatus: 'declined' }] }),
  ]];
  const r = await run(db);
  assert.equal(mine(db).length, 0);
  assert.equal(r.removed, 3);
});

test('multi-day and overnight events become one block row per day', async () => {
  const db = setup();
  google.pages = [[
    ev('night', '2026-10-15T22:00:00', '2026-10-16T02:00:00'),
    ev('trip', '2026-10-18T09:00:00', '2026-10-20T17:00:00'),
  ]];
  await run(db);
  const rows = mine(db).map((r) => [r.google_event_id, r.requested_date, r.assigned_time, r.duration_mins]).sort();
  assert.deepEqual(rows, [
    ['night', '2026-10-15', '10:00pm', 120],
    ['night', '2026-10-16', '12:00am', 120],
    ['trip', '2026-10-18', '9:00am', 900],
    ['trip', '2026-10-19', '12:00am', 1440],
    ['trip', '2026-10-20', '12:00am', 1020],
  ]);
  // Shrinking the trip removes only the days it no longer covers.
  google.pages = [[ev('night', '2026-10-15T22:00:00', '2026-10-16T02:00:00'), ev('trip', '2026-10-18T09:00:00', '2026-10-19T12:00:00')]];
  await run(db);
  assert.equal(mine(db).filter((r) => r.google_event_id === 'trip').length, 2);
});

// ── Failure: never guess in either direction ─────────────────────────────────────────────────
test('a failed sync keeps the last blocks and marks them stale: it deletes nothing and adds nothing', async () => {
  const db = setup();
  google.pages = [[ev('e1', '2026-10-15T10:00:00', '2026-10-15T11:00:00')]];
  await run(db);
  const before = JSON.stringify(mine(db));
  const log = []; const orig = console.error; console.error = (...a) => log.push(a.join(' '));
  try {
    for (const failure of [{ status: 500 }, { status: 401 }, { throws: true }]) {
      Object.assign(google, { status: 200, throws: false }, failure);
      google.pages = [[ev('e2', '2026-10-15T12:00:00', '2026-10-15T13:00:00')]]; // must NOT be invented
      const writesBefore = db.writes.length;
      const r = await run(db);
      assert.equal(r.ok, false);
      assert.equal(r.stale, true);
      assert.equal(db.writes.slice(writesBefore).filter((w) => w.entity === 'BookingRequest').length, 0, 'no booking-table writes at all');
      assert.equal(JSON.stringify(mine(db)), before);
    }
  } finally { console.error = orig; }
  assert.equal(stateOf(db).stale, true);
  assert.equal(stateOf(db).failure_count, 3);
  assert.equal(stateOf(db).consecutive_failures, 3);
  assert.ok(['google_unreachable', 'google_refused'].includes(stateOf(db).last_error));
  assert.doesNotMatch(JSON.stringify(stateOf(db)) + log.join(), /SECRET/);
  const summary = await G.importSummary(db.asServiceRole, USER, null, NOW);
  assert.deepEqual([summary.stale, summary.blocks_held], [true, 1]);
  // A later good sync clears the stale flag.
  Object.assign(google, { status: 200, throws: false, pages: [[ev('e1', '2026-10-15T10:00:00', '2026-10-15T11:00:00')]] });
  await run(db);
  assert.deepEqual([stateOf(db).stale, stateOf(db).consecutive_failures], [false, 0]);
});

test('a calendar too big to read completely is a failure, not a smaller calendar', async () => {
  const db = setup();
  google.pages = [[ev('e1', '2026-10-15T10:00:00', '2026-10-15T11:00:00')]];
  await run(db);
  google.pages = [[], [], [], [], [ev('late', '2026-10-15T12:00:00', '2026-10-15T13:00:00')]];
  const r = await run(db);
  assert.equal(r.error, 'too_many_events');
  assert.deepEqual(mine(db).map((x) => x.google_event_id), ['e1']);
});

test('an event with unreadable times keeps its existing block and marks the sync partial', async () => {
  const db = setup();
  google.pages = [[ev('e1', '2026-10-15T10:00:00', '2026-10-15T11:00:00')]];
  await run(db);
  google.pages = [[{ id: 'e1', status: 'confirmed', start: { dateTime: 'garbage' }, end: { dateTime: 'garbage' } }]];
  const r = await run(db);
  assert.equal(r.ok, false);
  assert.equal(mine(db).length, 1);
  assert.equal(stateOf(db).stale, true);
});

// ── Conflicts are warnings ───────────────────────────────────────────────────────────────────
test('a Google event overlapping an appointment produces a warning naming it, and changes no booking', async () => {
  const db = setup();
  const snapshot = JSON.stringify(db.tables.BookingRequest.filter((r) => FOREIGN.includes(r.id)));
  google.pages = [[ev('clash', '2026-10-15T14:30:00', '2026-10-15T15:30:00'), ev('clear', '2026-10-15T18:00:00', '2026-10-15T19:00:00')]];
  const r = await run(db);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual([r.conflicts[0].client_name, r.conflicts[0].date, r.conflicts[0].starts, r.conflicts[0].ends], ['Jane Smith', '2026-10-15', '2:00pm', '3:00pm']);
  assert.equal(JSON.stringify(db.tables.BookingRequest.filter((x) => FOREIGN.includes(x.id))), snapshot, 'no booking changed');
  assert.ok(db.writes.every((w) => w.entity !== 'BookingRequest' || w.op === 'create' || mine(db).some((m) => m.id === w.id)), 'only block rows written');
  // Dragged in Google to overlap: still only a warning on the next read.
  google.pages = [[ev('clash', '2026-10-15T14:00:00', '2026-10-15T14:45:00')]];
  const again = await run(db);
  assert.equal(again.conflicts.length, 1);
  assert.equal(db.tables.BookingRequest.find((x) => x.id === 'real1').assigned_time, '2:00pm');
});

// ── The rule that matters most ───────────────────────────────────────────────────────────────
test('the sync never creates, updates or deletes a row that is not one of its own block rows', async () => {
  const db = setup();
  const before = Object.fromEntries(FOREIGN.map((id) => [id, JSON.stringify(db.tables.BookingRequest.find((r) => r.id === id))]));
  const scenarios = [
    [ev('a', '2026-10-15T14:00:00', '2026-10-15T15:00:00'), ev('b', '2026-10-15T12:00:00', '2026-10-15T13:00:00'), allDay('d', '2026-10-16', '2026-10-17')],
    [ev('a', '2026-10-17T10:00:00', '2026-10-17T11:00:00')],
    [],
    [ev('ev-x', '2026-10-15T14:00:00', '2026-10-15T15:00:00'), ev('ev-sneaky', '2026-10-15T16:00:00', '2026-10-15T16:30:00'), ev('ev-other', '2026-10-16T09:00:00', '2026-10-16T10:00:00')],
  ];
  for (const includeAll of [false, true]) {
    stateOf(db).include_all_day = includeAll;
    for (const events of scenarios) { google.pages = [events]; await run(db); }
  }
  google.status = 500; await run(db);
  await G.removeAllOwnBlocks(db.asServiceRole, USER);

  for (const id of FOREIGN) {
    assert.equal(JSON.stringify(db.tables.BookingRequest.find((r) => r.id === id)), before[id], `${id} untouched`);
  }
  const bookingWrites = db.writes.filter((w) => w.entity === 'BookingRequest');
  assert.ok(bookingWrites.length > 0);
  for (const w of bookingWrites) {
    assert.ok(!FOREIGN.includes(w.id), `write ${w.op} touched ${w.id}`);
    if (w.op === 'create') assert.deepEqual([w.data.block_source, w.data.google_owner_user_id, isBlockRow(w.data)], ['google_calendar', USER, true]);
  }
  assert.deepEqual([...new Set(db.writes.map((w) => w.entity))].sort(), ['BookingRequest', 'CalendarImportState']);
});

test('the writer itself refuses anything that is not its own block row', async () => {
  const db = setup();
  const w = G.ownBlockWriter(db.asServiceRole, USER);
  for (const row of [hand, real, otherUsers, taggedButNotBlock]) {
    await assert.rejects(async () => w.update(row, { assigned_time: '1:00pm' }));
    await assert.rejects(async () => w.delete(row));
  }
  await assert.rejects(async () => w.create({ client_name: 'Jane', status: 'confirmed', block_source: 'google_calendar', google_owner_user_id: USER, google_event_id: 'x' }));
  await assert.rejects(async () => w.create({ client_name: '[BLOCK] x', block_source: 'google_calendar', google_owner_user_id: 'someone-else', google_event_id: 'x' }));
  const own = { id: 'o', client_name: G.BLOCK_NAME, block_source: 'google_calendar', google_owner_user_id: USER, google_event_id: 'e' };
  await assert.rejects(async () => w.update(own, { status: 'declined' }), 'only time fields may change');
  assert.equal(db.writes.length, 0);
});

test('a second barber\'s calendar is additive: each sync only manages its own owner\'s rows', async () => {
  const db = setup();
  google.pages = [[ev('shared-looking', '2026-10-15T10:00:00', '2026-10-15T11:00:00')]];
  await run(db);
  const db2State = { id: 's2', user_id: 'u2', enabled: true, include_all_day: false };
  db.tables.CalendarImportState.push(db2State);
  google.pages = [[ev('shared-looking', '2026-10-15T10:00:00', '2026-10-15T11:00:00')]];
  await G.runImport({ admin: db.asServiceRole, accessToken: 't2', userId: 'u2', state: db2State, now: NOW });
  assert.equal(db.tables.BookingRequest.filter((r) => r.google_event_id === 'shared-looking').length, 2);
  google.pages = [[]];
  await run(db);
  assert.deepEqual(db.tables.BookingRequest.filter((r) => r.google_event_id === 'shared-looking').map((r) => r.google_owner_user_id), ['u2']);
});

// ── Switch, privacy, throttle, gate ──────────────────────────────────────────────────────────
test('no event content is stored, logged or returned anywhere', async () => {
  const db = setup();
  const log = []; const orig = { e: console.error, l: console.log, w: console.warn };
  console.error = console.log = console.warn = (...a) => log.push(a.join(' '));
  try {
    google.pages = [[ev('e1', '2026-10-15T10:00:00', '2026-10-15T11:00:00', { attendees: [{ self: true, responseStatus: 'accepted', email: 'secret@x.test' }] }), allDay('d', '2026-10-16', '2026-10-17')]];
    stateOf(db).include_all_day = true;
    const r = await run(db);
    google.status = 500; await run(db);
    const s = await G.importSummary(db.asServiceRole, USER, null, NOW);
    assert.doesNotMatch(JSON.stringify([db.tables, r, s]) + log.join('\n'), /SECRET|secret@/);
  } finally { Object.assign(console, { error: orig.e, log: orig.l, warn: orig.w }); }
  // Google was asked for ids, times and free/busy only: no title, description or location.
  const asked = decodeURIComponent(fetchUrls[0]);
  assert.match(asked, /fields=summary,nextPageToken,items\(id,status,transparency,eventType,start,end,attendees\(self,responseStatus\),extendedProperties\/private\)/);
  assert.doesNotMatch(asked.split('fields=')[1], /description|location|organizer|creator|htmlLink/);
});

test('switching off removes the sync\'s own blocks and leaves hand-made blocks and bookings; switching on syncs again', async () => {
  const db = setup();
  google.pages = [[ev('a', '2026-10-15T10:00:00', '2026-10-15T11:00:00'), ev('b', '2026-10-16T10:00:00', '2026-10-16T11:00:00')]];
  await run(db);
  assert.equal(mine(db).length, 2);
  assert.equal(await G.removeAllOwnBlocks(db.asServiceRole, USER), 2);
  assert.equal(mine(db).length, 0);
  for (const id of FOREIGN) assert.ok(db.tables.BookingRequest.find((r) => r.id === id), `${id} still there`);
  await run(db);
  assert.equal(mine(db).length, 2);
});

test('the automatic run is throttled to once per 15 minutes per user', () => {
  const t = (mins) => ({ last_attempt_at: new Date(NOW.getTime() - mins * 60000).toISOString() });
  assert.equal(G.throttled(t(14), NOW), true);
  assert.equal(G.throttled(t(16), NOW), false);
  assert.equal(G.throttled({}, NOW), false);
});

test('freshness: more than 12 hours since the last good sync is reported as out of date', async () => {
  const db = setup();
  const hrs = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
  stateOf(db).last_success_at = hrs(2);
  assert.equal((await G.importSummary(db.asServiceRole, USER, null, NOW)).out_of_date, false);
  stateOf(db).last_success_at = hrs(13);
  assert.equal((await G.importSummary(db.asServiceRole, USER, null, NOW)).out_of_date, true);
  stateOf(db).last_success_at = undefined;
  assert.equal((await G.importSummary(db.asServiceRole, USER, null, NOW)).out_of_date, true);
});

const handler = await loadEntry('calendarImport');
const call = async (body, { headers = { authorization: 'Bearer t' }, user = { id: USER, email: 'a@x.test', role: 'admin' }, db = setup(), connected = true } = {}) => {
  let connectorCalls = 0;
  globalThis.__b44Client = () => ({
    auth: { me: async () => user },
    entities: db.entities,
    asServiceRole: { entities: db.entities, connectors: { getCurrentAppUserConnection: async () => { connectorCalls++; if (!connected) throw new Error('no'); return { accessToken: 'tok' }; } } },
  });
  const res = await handler(new Request('https://app.test/functions/calendarImport', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json(), db, connectorCalls };
};

test('an anonymous or unrelated caller is refused before any Google call or database read', async () => {
  const anon = await call({ action: 'sync' }, { headers: {} });
  assert.equal(anon.status, 401);
  const customer = await call({ action: 'sync' }, { user: { id: 'cust', email: 'c@x.test', role: 'user' } });
  assert.equal(customer.status, 403);
  const workflow = await call({ action: 'sync' }, { headers: { authorization: 'Bearer t', 'x-workflow-run': 'r1' } });
  assert.equal(workflow.status, 403);
  for (const r of [anon, customer, workflow]) assert.equal(r.connectorCalls, 0);
  assert.equal(fetchUrls.length, 0);
  assert.equal(anon.db.writes.length, 0);
});

test('the function: set on syncs, auto is throttled, a disconnected calendar is stale not destructive, set off removes own blocks only', async () => {
  const db = setup(); stateOf(db).enabled = false;
  // The function uses the real clock, so the event is dated relative to today (Sydney).
  const { nextDateLabel } = await import('../base44/shared/calendarSync.ts');
  const tomorrow = nextDateLabel(G.sydneyParts(Date.now()).date);
  google.pages = [[ev('a', `${tomorrow}T10:00:00`, `${tomorrow}T11:00:00`)]];
  const on = await call({ action: 'set', enabled: true }, { db });
  assert.equal(on.json.enabled, true);
  assert.equal(on.json.blocks_held, 1);
  assert.equal(on.json.account, 'owner@gmail.test');

  const auto = await call({ action: 'auto' }, { db });
  assert.deepEqual([auto.json.ran, auto.json.skipped], [false, 'throttled']);
  const fetchesAfterAuto = fetchUrls.length;
  await call({ action: 'auto' }, { db });
  assert.equal(fetchUrls.length, fetchesAfterAuto, 'no Google call while throttled');

  stateOf(db).last_attempt_at = new Date(Date.now() - 20 * 60000).toISOString();
  const down = await call({ action: 'sync' }, { db, connected: false });
  assert.deepEqual([down.json.ok, down.json.error, down.json.stale, down.json.blocks_held], [false, 'not_connected', true, 1]);

  const off = await call({ action: 'set', enabled: false }, { db });
  assert.equal(off.json.enabled, false);
  assert.equal(mine(db).length, 0);
  for (const id of FOREIGN) assert.ok(db.tables.BookingRequest.find((r) => r.id === id));
  const offSync = await call({ action: 'sync' }, { db });
  assert.equal(offSync.json.skipped, 'off');
});

// ── Guards ───────────────────────────────────────────────────────────────────────────────────
test('source guards: BookingRequest is only written through the own-block writer; the shared filters and engines are untouched', () => {
  const src = read('base44/shared/googleBusyImport.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((src.match(/entities\.BookingRequest/g) || []).length, 3, 'one handle for the writer, two filtered reads');
  assert.equal((src.match(/entities\.BookingRequest\.(create|update|delete|bulk|updateMany|deleteMany)/g) || []).length, 0);
  assert.deepEqual([...new Set((src.match(/table\.(\w+)\(/g) || []))].sort(), ['table.create(', 'table.delete(', 'table.update(']);
  assert.doesNotMatch(src, /entities\.(Message|MessageOutbox|DayRoute|RouteConnection|CalendarSync)\.(create|update|delete)/);
  assert.doesNotMatch(src, /enqueue|sendManual|twilio/i);
  assert.match(read('base44/shared/publicBusyBookings.ts'), /BLOCKING_STATUSES = \['confirmed', 'completed'\]/);
  // BlockTimeModal.jsx was in this byte-lock to stop a blanket restyle changing the
  // block row by accident. Sheet 12 moves its create behind createAdminBooking, so the
  // file legitimately changes and a byte-lock would only ever be in the way. What the
  // lock was protecting - the row's shape - is now pinned by behaviour instead:
  // the '[BLOCK] …' assertion above, and 'Block Time still creates "[BLOCK] …"' in
  // tests/adminBookingMerge.test.mjs, which checks the server ignores a price sent
  // by the browser. The other engines stay byte-locked: nothing should ever edit
  // those. routeFlowOptimiser.ts, dayRoute.ts and routeFingerprint.ts were released
  // from the lock by the Connect Appointments fix (one route per barber's whole day,
  // one drive leg per consecutive pair, and one shared rule for the day a route is
  // stamped from and judged against); tests/routeLegs.test.mjs pins that behaviour
  // instead. schedulingValidator.ts and appointmentTiming.ts were released with the
  // rounding fix: travel keeps its real minutes and the 5-minute step is applied once,
  // to the appointment start, in whole minutes.
  assert.equal(execSync(
    'git diff --stat -- base44/shared/reshuffleEngine.ts base44/shared/routeFlowEngine.ts base44/shared/publicBusyBookings.ts || true',
    { cwd: new URL('../', import.meta.url) },
  ).toString().trim(), '');
  // The modal must not have grown a direct write back.
  assert.doesNotMatch(read('src/components/schedule/BlockTimeModal.jsx'), /entities\.BookingRequest/);
});