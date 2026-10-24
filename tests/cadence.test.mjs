// Reminder cadence from real visits. No network, no database, no messages. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  measureCadence, resolveCadence, cadencePatch, explainCadence, storedSource, MIN_VISITS, MAX_GAP_DAYS, RECENT_VISITS,
} from '../base44/shared/cadence.ts';
import { explainCadence as uiExplain } from '../src/lib/cadence.js';
import { nextReminderFor, finishCompletion } from '../base44/shared/routeCompletion.ts';
import { runCadenceBackfill } from '../base44/shared/cadenceBackfill.ts';
import { staticCheck, dynamicCheck, readSettings } from '../base44/shared/campaignRules.ts';
import { quietHoursCheck } from '../base44/shared/messagingProtections.ts';
import { modeBlock } from '../base44/shared/messagingMode.ts';

const visits = (...dates) => dates.map((d, i) => ({ id: `b${i}`, status: 'completed', requested_date: d }));
const every = (n, count, start = '2026-01-01') => visits(...Array.from({ length: count }, (_, i) => new Date(Date.parse(start) + i * n * 86400000).toISOString().slice(0, 10)));

test('the median is used, and one long gap does not move it', () => {
  // gaps 14,14,14,14,60 -> median 14 (an average would be 23)
  const m = measureCadence(visits('2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26', '2026-04-27'));
  assert.equal(m.days, 14);
  assert.equal(m.visits, 6);
});

test('only the last handful of visits is used', () => {
  const early = every(60, 5, '2024-01-01');
  const recent = every(14, RECENT_VISITS, '2026-01-01');
  assert.equal(measureCadence([...early, ...recent]).days, 14);
});

test('only completed visits count: no-shows, cancellations, declined, pending and test data do not', () => {
  const real = every(21, 4);
  const noise = ['no_show', 'cancelled', 'declined', 'pending', 'could_not_fit'].map((status, i) => ({ id: `n${i}`, status, requested_date: `2026-03-0${i + 1}` }));
  const test = { id: 't', status: 'completed', is_test: true, requested_date: '2026-03-09' };
  assert.deepEqual(measureCadence([...real, ...noise, test]), measureCadence(real));
  assert.equal(measureCadence([...every(21, 3), ...noise, test]).days, null);
});

test('a gap above the ceiling is excluded entirely, not clamped', () => {
  assert.equal(MAX_GAP_DAYS, 120);
  // gaps 10,20,30,400,400. Excluded: median of 10,20,30 = 20. Clamping to 120 would give 30.
  const m = measureCadence(visits('2026-01-01', '2026-01-11', '2026-01-31', '2026-03-02', '2027-04-06', '2028-05-10'));
  assert.equal(m.excludedGaps, 2);
  assert.equal(m.usableGaps, 3);
  assert.equal(m.days, 20);
  // too many absurd gaps leave too few usable ones: no measurement at all
  const few = measureCadence(visits('2026-01-01', '2026-01-11', '2027-01-11', '2027-01-21'));
  assert.equal(few.days, null);
  assert.equal(few.reason, 'not_enough_usable_gaps');
});

test('below the minimum visit count nothing is measured and the label is used', () => {
  assert.equal(MIN_VISITS, 4);
  for (const n of [0, 1, 2, 3]) assert.equal(measureCadence(every(14, n)).days, null);
  assert.equal(measureCadence(every(14, 4)).days, 14);
  const c = { frequency: 'Fortnightly', cadence_source: 'default', cadence_interval_days: null, cadence_visit_count: 3 };
  assert.equal(resolveCadence(c).days, 14);
  assert.match(explainCadence({ frequency: 'Monthly', cadence_source: 'default', cadence_visit_count: 2 }).text, /Not enough history, using Monthly/);
});

test('a manual cadence beats a measured one; a default never does', () => {
  const measured = { cadence_interval_days: 18, cadence_visit_count: 6 };
  assert.equal(resolveCadence({ frequency: 'Fortnightly', cadence_source: 'manual', ...measured }).days, 14);
  const def = resolveCadence({ frequency: 'Monthly', cadence_source: 'default', ...measured });
  assert.equal(def.days, 18);
  assert.equal(def.source, 'observed');
  // a default with NO measurement stays on its label
  assert.equal(resolveCadence({ frequency: 'Monthly', cadence_source: 'default' }).days, 30);
  // the disagreement is shown, with both numbers
  const e = explainCadence({ frequency: 'Fortnightly', cadence_source: 'manual', ...measured });
  assert.match(e.text, /Fortnightly/); assert.match(e.text, /18 days, from 6 visits/); assert.equal(e.can_accept, true);
  assert.match(explainCadence({ frequency: 'Monthly', cadence_source: 'default', ...measured }).text, /about every 18 days, from 6 visits/);
});

test('older records: a label other than Monthly is a person\'s choice; a bare Monthly is unconfirmed and is not replaced', () => {
  assert.equal(storedSource({ frequency: 'Fortnightly' }), 'manual');
  assert.equal(storedSource({ frequency: 'Custom', custom_frequency_days: 10 }), 'manual');
  assert.equal(storedSource({ frequency: 'Monthly' }), 'unknown');
  assert.equal(resolveCadence({ frequency: 'Monthly', cadence_interval_days: 18, cadence_visit_count: 6 }).days, 30);
  assert.equal(storedSource({ frequency: 'Monthly' }, { monthlyIsDefault: true }), 'default');
});

test('next_reminder_date follows the winning source, and is recalculated when a visit completes', async () => {
  const visit = '2026-10-14';
  assert.equal(nextReminderFor({ frequency: 'Fortnightly' }, visit), '2026-10-28');
  assert.equal(nextReminderFor({ frequency: 'Custom', custom_frequency_days: 10 }, visit), '2026-10-24');
  assert.equal(nextReminderFor({ frequency: 'Whenever' }, visit), null);
  assert.equal(nextReminderFor({ frequency: 'Monthly', cadence_source: 'default', cadence_interval_days: 18, cadence_visit_count: 6 }, visit), '2026-11-01');
  assert.equal(nextReminderFor({ frequency: 'Fortnightly', cadence_source: 'manual', cadence_interval_days: 18, cadence_visit_count: 6 }, visit), '2026-10-28');

  // Completing the 4th evenly spaced visit measures 14 days and uses it in place of the Monthly default.
  const done = every(14, 3, '2026-09-02'); // 02 Sep, 16 Sep, 30 Sep
  const client = { id: 'c1', client_name: 'Sam', frequency: 'Monthly', cadence_source: 'default' };
  const updates = [];
  const admin = { entities: {
    BookingRequest: { update: async () => ({}), filter: async () => [...done, { id: 'now', status: 'completed', requested_date: visit }] },
    ReminderClient: { get: async () => client, update: async (id, p) => { updates.push(p); return {}; }, filter: async () => [] },
  } };
  await finishCompletion(admin, { id: 'now', status: 'pending', client_id: 'c1', client_name: 'Sam', requested_date: visit }, '2026-10-14T05:00:00.000Z');
  const p = updates[0];
  assert.equal(p.cadence_interval_days, 14);
  assert.equal(p.cadence_source, 'observed');
  assert.equal(p.next_reminder_date, '2026-10-28');
});

test('frontend wording matches the server wording', () => {
  const samples = [
    { frequency: 'Monthly', cadence_source: 'default', cadence_interval_days: 18, cadence_visit_count: 6 },
    { frequency: 'Fortnightly', cadence_source: 'manual', cadence_interval_days: 18, cadence_visit_count: 6 },
    { frequency: 'Monthly' }, { frequency: 'Monthly', cadence_interval_days: 20, cadence_visit_count: 5 },
    { frequency: 'Custom', custom_frequency_days: 10, cadence_source: 'manual' }, { frequency: 'Weekly' },
  ];
  for (const s of samples) assert.deepEqual(uiExplain(s), explainCadence(s));
});

// ── backfill ────────────────────────────────────────────────────────────────
function fakeDb(clients, bookings) {
  const rows = clients.map(c => ({ ...c }));
  const page = (list) => ({ items: list, has_more: false });
  return {
    rows,
    entities: {
      ReminderClient: {
        filter: async () => page(rows),
        update: async (id, patch) => { Object.assign(rows.find(r => r.id === id), patch); },
      },
      BookingRequest: { filter: async (q) => page(bookings.filter(b => q.client_id.$in.includes(b.client_id))) },
    },
  };
}
const forClient = (id, list) => list.map(b => ({ ...b, client_id: id }));

test('backfill reports, leaves manual clients alone, and is safe to run twice', async () => {
  const bookings = [
    ...forClient('reg', every(18, 6, '2026-01-01')),               // default Monthly, 6 visits every 18 days
    ...forClient('man', every(18, 6, '2026-01-01')),               // Alvaro chose Fortnightly
    ...forClient('few', every(18, 2, '2026-01-01')),               // not enough history
    ...forClient('old', every(18, 6, '2026-01-01')),               // older bare Monthly: unconfirmed
  ];
  const last = '2026-04-01';
  const clients = [
    { id: 'reg', client_name: 'Reg', frequency: 'Monthly', cadence_source: 'default', last_visit_date: last, next_reminder_date: '2026-05-01' },
    { id: 'man', client_name: 'Man', frequency: 'Fortnightly', cadence_source: 'manual', last_visit_date: last, next_reminder_date: '2026-04-15' },
    { id: 'few', client_name: 'Few', frequency: 'Monthly', cadence_source: 'default', last_visit_date: last, next_reminder_date: '2026-05-01' },
    { id: 'old', client_name: 'Old', frequency: 'Monthly', last_visit_date: last, next_reminder_date: '2026-05-01' },
    { id: 'tst', client_name: 'Tst', frequency: 'Monthly', is_test: true },
  ];
  const db = fakeDb(clients, bookings);
  const now = new Date('2026-04-25T00:00:00Z');

  const preview = await runCadenceBackfill(db, { apply: false, now });
  assert.deepEqual(db.rows, clients, 'a preview writes nothing');
  assert.equal(preview.measured, 1); assert.equal(preview.left_alone_manual, 1); assert.equal(preview.lacked_history, 1);
  assert.equal(preview.ambiguous_not_used, 1); assert.equal(preview.skipped_test, 1);
  assert.equal(preview.dates_sooner, 1);   // Reg: 1 Apr + 30 = 1 May becomes 1 Apr + 18 = 19 Apr
  assert.equal(preview.becoming_due_now, 1);

  const first = await runCadenceBackfill(db, { apply: true, now });
  assert.equal(first.records_written, 4); // reg, man and old get the measurement stored beside the label; few gets its visit count
  const reg = db.rows.find(r => r.id === 'reg');
  assert.equal(reg.cadence_source, 'observed'); assert.equal(reg.cadence_interval_days, 18); assert.equal(reg.next_reminder_date, '2026-04-19');
  const man = db.rows.find(r => r.id === 'man');
  assert.equal(man.frequency, 'Fortnightly'); assert.equal(man.cadence_source, 'manual'); assert.equal(man.next_reminder_date, '2026-04-15'); assert.equal(man.cadence_interval_days, 18);
  const old = db.rows.find(r => r.id === 'old');
  assert.equal(old.next_reminder_date, '2026-05-01'); assert.equal(old.cadence_interval_days, 18); assert.equal(old.cadence_source, undefined);

  const snapshot = JSON.stringify(db.rows);
  const second = await runCadenceBackfill(db, { apply: true, now: new Date('2026-04-26T00:00:00Z') });
  assert.equal(second.records_written, 0);
  assert.equal(second.dates_sooner + second.dates_later + second.dates_newly_set, 0);
  assert.equal(JSON.stringify(db.rows), snapshot, 'a second run changes nothing, not even the computed-at time');
});

test('a reminder date a person set by hand is not moved by the backfill', async () => {
  const db = fakeDb(
    [{ id: 'h', client_name: 'Hand', frequency: 'Monthly', cadence_source: 'default', last_visit_date: '2026-04-01', next_reminder_date: '2026-05-20' }],
    forClient('h', every(18, 6, '2026-01-01')),
  );
  const r = await runCadenceBackfill(db, { apply: true, now: new Date('2026-06-01T00:00:00Z') });
  assert.equal(db.rows[0].next_reminder_date, '2026-05-20');
  assert.equal(r.dates_left_alone, 1);
});

// ── existing suppressions are untouched ─────────────────────────────────────
test('every existing suppression still fires', () => {
  const today = '2026-10-15';
  const base = { id: 'c', client_name: 'Sam', phone: '0412345678', frequency: 'Monthly', next_reminder_date: '2026-10-10', client_type: 'Regular' };
  const why = (c) => { const o = staticCheck(c, { today, maxOverdueDays: 180 }); return o.ok ? 'ok' : (o.reason || o.aggregate); };
  assert.equal(why(base), 'ok');
  assert.equal(why({ ...base, messaging_opted_out: true }), 'opted_out');          // consent / STOP
  assert.equal(why({ ...base, frequency: 'Whenever', next_reminder_date: undefined }), 'no_cadence');
  assert.equal(why({ ...base, cadence_source: 'observed', cadence_interval_days: 18, cadence_visit_count: 6, next_reminder_date: '2026-11-01' }), 'not_due');
  // has_booking
  const facts = { bookings: [{ status: 'confirmed', requested_date: '2026-10-20' }], repliedYmds: [], attentionOpen: false, campaignMessagesThisWeek: 0 };
  assert.equal(dynamicCheck(facts, { today, weekStart: '2026-10-12' }).reason, 'has_booking');
  // quiet hours, messaging mode and the dry run are separate gates and are unchanged
  assert.equal(quietHoursCheck(new Date('2026-10-14T20:00:00Z')).quiet, true);
  assert.ok(modeBlock({ mode: 'off', allowlist: new Set() }, { channel: 'sms', to_address: '+61412345678' }));
  assert.equal(readSettings(undefined).dry_run, true);
  assert.equal(readSettings({ campaign_dry_run: false }).dry_run, false);
});