// Tests for the hardening pass: public-endpoint rate limiting, refused unauthenticated
// calls, the audit trail, the overdue-job check and dead-letter re-queue.
// No network, no database, no real messages. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { rateLimitBuckets, takeRateLimitSlot, PUBLIC_SEARCH_LIMITS } from '../base44/shared/bookingProtection.ts';
import { buildAuditRow, recordAudit, finishAudit, scrub } from '../base44/shared/auditLog.ts';
import { requeueDeadLetter } from '../base44/shared/deadLetterRequeue.ts';
import { overdueJobs, jobView } from '../src/lib/jobOverdue.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// ── A tiny in-memory database: just the calls these modules make ──────────────────────
function makeDb(seed = {}, { failEntity } = {}) {
  const tables = {};
  let n = 0;
  const table = (name) => (tables[name] ||= (seed[name] || []).map((r) => ({ ...r })));
  const match = (r, q) => Object.entries(q || {}).every(([k, v]) => r[k] === v);
  const entities = new Proxy({}, {
    get: (_t, name) => ({
      filter: async (q) => table(name).filter((r) => match(r, q)),
      get: async (id) => { const r = table(name).find((x) => x.id === id); if (!r) throw new Error('not found'); return r; },
      create: async (data) => { if (name === failEntity) throw new Error('write failed'); const r = { id: `${name}${++n}`, ...data }; table(name).push(r); return r; },
      update: async (id, data) => { if (name === failEntity) throw new Error('write failed'); Object.assign(table(name).find((x) => x.id === id), data); return table(name).find((x) => x.id === id); },
      deleteMany: async () => ({}),
    }),
  });
  return { entities, rows: (name) => table(name) };
}

// ── 1. Rate limiter ─────────────────────────────────────────────────────────────────────
test('the address search allows 30 a minute and refuses the 31st with a wait time', async () => {
  assert.deepEqual(PUBLIC_SEARCH_LIMITS, { perMinute: 30, perHour: 300 });
  const db = makeDb();
  const t = Date.UTC(2026, 9, 14, 3, 0, 10);
  for (let i = 0; i < 30; i++) assert.equal((await takeRateLimitSlot(db, 'mapbox_geocode', 'abc', PUBLIC_SEARCH_LIMITS, t)).allowed, true, `call ${i + 1}`);
  const refused = await takeRateLimitSlot(db, 'mapbox_geocode', 'abc', PUBLIC_SEARCH_LIMITS, t);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 60);
});

test('the next minute starts a fresh window, and a refused call is not counted', async () => {
  const db = makeDb();
  const t = Date.UTC(2026, 9, 14, 3, 0, 10);
  for (let i = 0; i < 30; i++) await takeRateLimitSlot(db, 's', 'abc', PUBLIC_SEARCH_LIMITS, t);
  for (let i = 0; i < 5; i++) await takeRateLimitSlot(db, 's', 'abc', PUBLIC_SEARCH_LIMITS, t); // all refused
  const hour = db.rows('RateLimitHit').find((r) => r.bucket.includes('|h|'));
  assert.equal(hour.count, 30, 'refused calls must not burn the hourly allowance');
  assert.equal((await takeRateLimitSlot(db, 's', 'abc', PUBLIC_SEARCH_LIMITS, t + 60_000)).allowed, true);
});

test('the hourly ceiling of 300 holds even when each minute is within its own limit', async () => {
  const db = makeDb();
  const base = Date.UTC(2026, 9, 14, 3, 0, 0);
  let allowed = 0;
  for (let m = 0; m < 12; m++) for (let i = 0; i < 30; i++) {
    if ((await takeRateLimitSlot(db, 's', 'abc', PUBLIC_SEARCH_LIMITS, base + m * 60_000 + 1000)).allowed) allowed++;
  }
  assert.equal(allowed, 300);
});

test('callers are counted separately; a request with no readable address shares one bucket with 5x the ceiling', async () => {
  const db = makeDb();
  const t = Date.UTC(2026, 9, 14, 3, 0, 10);
  for (let i = 0; i < 30; i++) await takeRateLimitSlot(db, 's', 'aaa', PUBLIC_SEARCH_LIMITS, t);
  assert.equal((await takeRateLimitSlot(db, 's', 'bbb', PUBLIC_SEARCH_LIMITS, t)).allowed, true);
  const [m] = rateLimitBuckets('s', null, PUBLIC_SEARCH_LIMITS, t);
  assert.equal(m.limit, 150);
});

test('mapboxGeocode answers 429 when refused and does not block when the limiter itself fails', () => {
  const src = read('base44/functions/mapboxGeocode/entry.ts');
  assert.match(src, /takeRateLimitSlot\(admin, 'mapbox_geocode'/);
  assert.match(src, /status: 429/);
  assert.ok(src.indexOf('takeRateLimitSlot(') < src.indexOf('mapboxGeocodeSearch(input'), 'limit before the paid call');
  assert.match(src, /rate limiter unavailable, allowing the search/);
});

test('the other public endpoints that read or write for strangers are throttled too', () => {
  const status = read('base44/functions/checkBookingStatus/entry.ts');
  assert.ok(status.indexOf('takeRateLimitSlot(') < status.indexOf('BookingRequest.filter'), 'status lookup throttled before reading bookings');
  assert.match(status, /catch \{ verdict = \{ allowed: false/, 'status lookup fails closed');
  const enquiry = read('base44/functions/submitGroupEnquiry/entry.ts');
  assert.ok(enquiry.indexOf('takeRateLimitSlot(') < enquiry.indexOf('GroupBookingEnquiry.create'));
});

// ── 2. Unauthenticated calls are refused ────────────────────────────────────────────────
// These functions import from npm:/runtime specifiers that Node cannot load, so the
// gate is checked in the source: it must exist and run before any data access or paid call.
const GATED = {
  googlePlacesAutocomplete: ['googlePlacesSearch', 'fetch('],
  googlePlaceDetails: ['googlePlaceDetails', 'fetch('],
  mapboxDriveMatrix: ['mapboxDriveMatrix(coords'],
  requeueDeadLetter: ['requeueDeadLetter(base44'],
  deleteClients: ['deleteByIds('],
  deleteTestData: ['deleteByIds('],
  removeTeamMember: ['entities.TeamMember.delete('],
  inviteStaffMember: ['entities.TeamMember.create('],
  paymentAction: ['provider.refund('],
};
for (const [name, work] of Object.entries(GATED)) {
  test(`${name} refuses a caller who is not admin / staff before doing any work`, () => {
    const src = read(`base44/functions/${name}/entry.ts`);
    const gate = src.search(/requireAdminActor|resolveSchedulingActor|requireSchedulingActor|role !== 'admin'/);
    assert.ok(gate > 0, 'has a gate');
    assert.match(src, /status: 40[13]|actor\.status|auth\.status/);
    for (const w of work) {
      const at = src.indexOf(w);
      if (at >= 0) assert.ok(gate < at, `${name}: gate runs before ${w}`);
    }
  });
}

test('geocodeAddress is gone and nothing in the app calls it', () => {
  const dirs = readdirSync(new URL('base44/functions/', root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const live = dirs.filter((n) => { try { read(`base44/functions/${n}/entry.ts`); return true; } catch { return false; } });
  assert.ok(!live.includes('geocodeAddress'));
  const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(`${dir}${d.name}/`) : [`${dir}${d.name}`]);
  for (const f of walk('src/').filter((p) => /\.(js|jsx)$/.test(p))) assert.doesNotMatch(read(f), /geocodeAddress/, f);
});

// ── 3. One audit row per action, and destructive actions abort when it cannot be written ─
test('an action leaves exactly one ActivityLog row: written first, then updated, never a second', async () => {
  const db = makeDb();
  const id = await recordAudit(db, { action: 'clients_deleted', who: 'Alvaro', summary: 'Clients deleted', counts: { clients: 3 } });
  assert.ok(id);
  assert.equal(await finishAudit(db, id, { action: 'clients_deleted', who: 'Alvaro', summary: 'Clients deleted', counts: { clients: 2 } }), true);
  const rows = db.rows('ActivityLog');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details_json.counts.clients, 2, 'final counts replace the planned ones');
  assert.equal(rows[0].actor_name, 'Alvaro');
});

test('recordAudit returns null instead of throwing when the log cannot be written', async () => {
  const db = makeDb({}, { failEntity: 'ActivityLog' });
  assert.equal(await recordAudit(db, { action: 'x', who: 'A', summary: 's' }), null);
});

const DESTRUCTIVE = {
  deleteClients: 'deleteByIds(',
  deleteTestData: 'deleteByIds(',
  removeTeamMember: 'TeamMember.delete(',
  inviteStaffMember: 'TeamMember.create(',
  migratePaymentState: 'createPaymentForBooking(',
};

// A refund now lives in one shared service (used by paymentAction and declineBookingRequest).
test('refundService writes its audit row before Square is asked, and refuses if that fails', () => {
  const src = read('base44/shared/refundService.ts');
  assert.match(src, /AUDIT_REFUSED/);
  assert.ok(src.indexOf('recordAudit(') > 0 && src.indexOf('recordAudit(') < src.indexOf('provider.refund('));
});
for (const [name, change] of Object.entries(DESTRUCTIVE)) {
  test(`${name} writes its audit row before it changes anything and refuses if that fails`, () => {
    const src = read(`base44/functions/${name}/entry.ts`);
    assert.match(src, /AUDIT_REFUSED/, 'returns the refusal');
    const audit = src.search(/recordAudit\(|auditFirst\(|audit\(\)/);
    const bodyStart = src.indexOf('export default');
    const firstChange = src.indexOf(change, bodyStart);
    const callAt = src.search(/(?:await )?(?:recordAudit|auditFirst|audit)\(/g);
    assert.ok(audit > 0 && callAt > 0);
    const firstCall = [...src.matchAll(/(?:recordAudit|auditFirst|audit)\(/g)].map((m) => m.index).find((i) => i > bodyStart);
    assert.ok(firstCall < firstChange, `${name}: audit call at ${firstCall} must come before ${change} at ${firstChange}`);
  });
}

test('turning campaign dry-run OFF is rolled back when its activity-log row cannot be written', () => {
  const src = read('base44/functions/setCampaignDryRun/entry.ts');
  assert.match(src, /if \(!logged\) throw new Error\('activity log write failed'\)/);
});

test('every function that changes money, data, staff or sends a message writes an audit row', () => {
  const expected = {
    deleteClients: 'clients_deleted', deleteTestData: 'test_data_deleted', removeTeamMember: 'team_member_deleted',
    inviteStaffMember: 'staff_invited', paymentAction: 'payment_', migratePaymentState: 'payment_state_migrated',
    applyManualPlacement: 'booking_placed', confirmBooking: 'booking_confirmed', sendManualMessage: 'manual_message_queued',
    assistantSendDraft: 'assistant_draft_sent', setCampaignDryRun: 'campaign_dry_run_off', requeueDeadLetter: null,
  };
  for (const [name, action] of Object.entries(expected)) {
    const src = name === 'requeueDeadLetter' ? read('base44/shared/deadLetterRequeue.ts') : read(`base44/functions/${name}/entry.ts`);
    assert.match(src, /recordAudit\(|auditFirst\(/, name);
    if (action) assert.ok(src.includes(action), `${name} records ${action}`);
  }
});

// ── 4. No phone number or message body in any audit row ─────────────────────────────────
test('a row never carries a phone number, email address or message text', () => {
  const row = buildAuditRow({
    action: 'manual_message_queued', who: 'Alvaro 0412 345 678',
    summary: 'Sent to +61 412 345 678 and jo@example.com', note: 'Call 0412345678 or email a.b@c.com.au',
    counts: { characters: 42, bad: NaN }, ids: { client_id: 'abc123', outbox_id: 'a b c', phone: '0412345678' },
  });
  const flat = JSON.stringify(row);
  assert.doesNotMatch(flat, /0412|412 345|jo@example|a\.b@c/);
  assert.equal(row.details_json.ids.client_id, 'abc123');
  assert.equal(row.details_json.ids.outbox_id, undefined, 'a non-id value is dropped');
  assert.equal(row.details_json.ids.phone, undefined);
  assert.equal(row.details_json.counts.bad, undefined);
  assert.equal(scrub('0412 345 678'), '[removed]');
});

test('no call site hands a phone number, address or message body to the audit writer', () => {
  const FORBIDDEN = /to_address|rendered_text|draft_text|reply_text|inbound_text|\.phone\b|\.email\b|\.address\b|\btext\b(?!\.length)/;
  const dir = new URL('base44/functions/', root);
  for (const d of readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    let src; try { src = read(`base44/functions/${d.name}/entry.ts`); } catch { continue; }
    for (const m of src.matchAll(/(?:recordAudit|finishAudit|auditFirst)\(/g)) {
      const block = src.slice(m.index, src.indexOf('});', m.index) + 3);
      // `who:` is the signed-in staff member's own name (scrub() strips any email/number from it), never a customer.
      const checked = block.replace(/'[^']*'/g, "''").replace(/who:[^\n]*/g, '');
      assert.doesNotMatch(checked, FORBIDDEN, `${d.name}: ${block.slice(0, 120)}`);
    }
  }
});

// ── 5. Overdue-job badge and banner ─────────────────────────────────────────────────────
const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 14, 3, 0, 0);
const ranAgo = (min) => new Date(NOW - min * MIN).toISOString();
const beats = (o) => Object.fromEntries(Object.entries(o).map(([k, m]) => [k, { job_key: k, last_run_at: ranAgo(m) }]));

test('a job is overdue only after its own limit: sweep 15 min, arrival 90 min, campaign 25 h', () => {
  const ok = overdueJobs({ beats: beats({ sweep: 10, arrival: 80, campaign: 24 * 60 }) }, NOW);
  assert.deepEqual(ok.map((j) => j.key), []);
  const late = overdueJobs({ beats: beats({ sweep: 16, arrival: 91, campaign: 25 * 60 + 1 }) }, NOW);
  assert.deepEqual(late.map((j) => j.key), ['sweep', 'arrival', 'campaign']);
});

test('a job that has never run is overdue, and the sweep falls back to its own health record', () => {
  assert.equal(jobView('arrival', { beats: {} }, NOW).neverRun, true);
  assert.ok(overdueJobs({ beats: {} }, NOW).some((j) => j.key === 'arrival'));
  const viaHealth = overdueJobs({ beats: beats({ arrival: 5, campaign: 5 }), health: { last_run_at: ranAgo(3) } }, NOW);
  assert.deepEqual(viaHealth, []);
});

test('Route Flow auto-place and reshuffle are never reported overdue: a quiet day is normal for them', () => {
  const r = overdueJobs({ beats: { ...beats({ sweep: 1, arrival: 1, campaign: 1 }) } }, NOW);
  assert.deepEqual(r, []);
  assert.ok(!['autoplace', 'reshuffle'].some((k) => overdueJobs({ beats: {} }, NOW).map((j) => j.key).includes(k)));
});

test('the sidebar shows the count on Settings and the banner sits above every admin page', () => {
  const layout = read('src/components/admin/AdminSidebarLayout.jsx');
  assert.match(layout, /item\.to === '\/admin\/settings' && overdueCount > 0/);
  assert.ok(layout.indexOf('<OverdueJobsBanner') < layout.indexOf('<Outlet'));
  assert.equal((layout.match(/overdueCount=\{overdue\.length\}/g) || []).length, 2, 'desktop and mobile sidebars');
  const banner = read('src/components/automation/OverdueJobsBanner.jsx');
  assert.match(banner, /setDismissed/);
  assert.match(banner, /to="\/admin\/settings\/messaging"/);
});

// ── 6. Dead-letter re-queue ─────────────────────────────────────────────────────────────
const dead = (extra = {}) => ({ id: 'o1', status: 'dead_letter', attempt_count: 5, booking_request_id: 'b1', client_id: 'c1', last_error: 'x', dead_letter_reason: 'gave up', history: [], ...extra });
const live = { id: 'b1', status: 'confirmed' };
const allow = { recipientBlock: async () => null };

test('a dead letter goes back to pending with attempts cleared and exactly one audit row', async () => {
  const db = makeDb({ MessageOutbox: [dead()], BookingRequest: [live] });
  const r = await requeueDeadLetter(db, 'o1', 'Alvaro', allow, new Date('2026-10-14T03:00:00Z'));
  assert.equal(r.ok, true);
  const o = db.rows('MessageOutbox')[0];
  assert.equal(o.status, 'pending');
  assert.equal(o.attempt_count, 0);
  assert.equal(o.dead_letter_reason, '');
  assert.equal(o.history.at(-1).result, 'requeued');
  const log = db.rows('ActivityLog');
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'outbox_requeued');
});

const REFUSALS = [
  ['an item that is not dead-lettered', dead({ status: 'sent' }), [live], allow, 409, 'NOT_DEAD_LETTER'],
  ['a message that does not exist', null, [live], allow, 404, 'NOT_FOUND'],
  ['a booking that no longer exists', dead(), [], allow, 409, 'BOOKING_GONE'],
  ['a cancelled booking', dead(), [{ ...live, request_outcome: 'Cancelled' }], allow, 409, 'BOOKING_CANCELLED'],
  ['a declined booking', dead(), [{ ...live, status: 'declined' }], allow, 409, 'BOOKING_CANCELLED'],
  ['a customer who opted out', dead(), [live], { recipientBlock: async () => 'opted out' }, 409, 'RECIPIENT_BLOCKED'],
  ['a customer who declined messaging on the form', dead(), [live], { recipientBlock: async () => 'no messaging consent' }, 409, 'RECIPIENT_BLOCKED'],
];
for (const [label, item, bookings, deps, status, code] of REFUSALS) {
  test(`re-queue refuses ${label} and changes nothing`, async () => {
    const db = makeDb({ MessageOutbox: item ? [item] : [], BookingRequest: bookings });
    const r = await requeueDeadLetter(db, 'o1', 'Alvaro', deps);
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.equal(r.code, code);
    assert.equal(db.rows('MessageOutbox')[0]?.status, item?.status, 'item untouched');
    assert.equal(db.rows('ActivityLog').length, 0, 'no audit row for a refusal');
  });
}

test('re-queue leaves the item dead-lettered when the audit row cannot be written', async () => {
  const db = makeDb({ MessageOutbox: [dead()], BookingRequest: [live] }, { failEntity: 'ActivityLog' });
  const r = await requeueDeadLetter(db, 'o1', 'Alvaro', allow);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AUDIT_FAILED');
  assert.equal(db.rows('MessageOutbox')[0].status, 'dead_letter');
});

test('the re-queue function needs a person (automation refused) and uses the sweep\'s own consent check', () => {
  const src = read('base44/functions/requeueDeadLetter/entry.ts');
  assert.match(src, /actor\.automation\) return Response\.json\(\{ error: 'A person must re-queue/);
  assert.match(src, /from '\.\.\/\.\.\/shared\/recipientGuard\.ts'/);
  assert.match(read('base44/functions/processMessageOutbox/guards.ts'), /export \{ recipientBlock \} from '\.\.\/\.\.\/shared\/recipientGuard\.ts'/);
});

// ── 6. Public booking data, invite check, manual-send audit ─────────────────────────────
test('publicBookingData is throttled (fail open), date-windowed, and returns only busy bookings', () => {
  const src = read('base44/functions/publicBookingData/entry.ts');
  assert.match(src, /takeRateLimitSlot\(base44\.asServiceRole, 'public_booking_data'/);
  assert.match(src, /catch \(e\) \{\s*console\.error\('\[publicBookingData\] rate limiter unavailable, allowing/, 'a broken limiter lets the page load');
  assert.match(src, /status: 429/);
  assert.match(src, /requested_date: \{ \$gte: windowStart, \$lte: windowEnd \}/);
  assert.match(src, /status: \{ \$in: DEMAND_STATUSES \}/);
  assert.match(src, /MAX_BOOKINGS_READ = 500/);
  assert.match(src, /bookings: busyBookings/);
  assert.doesNotMatch(src, /error: error\.message/);
});

test('validateStaffInvite never returns raw error text', () => {
  const src = read('base44/functions/validateStaffInvite/entry.ts');
  assert.doesNotMatch(src, /error: error\.message/);
  assert.match(src, /could not check this invitation/);
});

test('sendManualMessage writes its audit row before queuing, and refuses if it cannot', () => {
  const src = read('base44/functions/sendManualMessage/entry.ts');
  const first = src.indexOf('recordAudit(admin');
  assert.ok(first > 0 && first < src.indexOf('enqueueOutboxMessage(admin'), 'audit comes before the queue call');
  assert.match(src, /if \(!logId\) return Response\.json\(AUDIT_REFUSED/);
});