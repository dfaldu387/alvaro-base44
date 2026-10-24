// Tests for the assistant's free-text booking conversations, with the scheduling engine faked.
// Proves: only engine slots are offered, acceptance is re-validated, a gone slot is never booked,
// strangers get the link, and a booking is created once, only through the injected creator.
// No network, no database, no model. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleInbound } from '../base44/shared/assistantFlow.ts';
import { enqueueOutboxMessage } from '../base44/shared/outboxEnqueue.ts';

const NOW = new Date('2026-10-13T23:00:00Z'); // Wed 14 Oct 2026, 10:00 Sydney
const LATER = new Date('2026-10-14T00:30:00Z');

function matches(rec, q = {}) {
  return Object.entries(q).every(([k, cond]) => {
    const v = rec[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === '$in') return x.includes(v);
        if (op === '$ne') return v !== x;
        if (op === '$gte') return v !== undefined && String(v) >= String(x);
        if (op === '$lte') return v !== undefined && String(v) <= String(x);
        throw new Error(`fake db: unsupported operator ${op}`);
      });
    }
    return v === cond;
  });
}
function makeDb(seed = {}) {
  const tables = {}; let n = 0;
  const table = (name) => (tables[name] ||= []);
  for (const [name, rows] of Object.entries(seed)) for (const r of rows) table(name).push({ created_date: `2026-01-01T00:00:${String(n++).padStart(2, '0')}Z`, ...r });
  const entity = (name) => ({
    list: async () => [...table(name)].reverse(),
    filter: async (q, _s, limit) => table(name).filter(r => matches(r, q)).slice(0, limit || 1000),
    count: async (q) => table(name).filter(r => matches(r, q)).length,
    get: async (id) => table(name).find(x => x.id === id),
    create: async (d) => { const r = { id: `${name}-${++n}`, created_date: new Date(Date.UTC(2026, 9, 14, 0, 0, n)).toISOString(), ...d }; table(name).push(r); return r; },
    update: async (id, d) => Object.assign(table(name).find(x => x.id === id), d),
    updateMany: async () => ({ modified_count: 0 }),
    delete: async () => {},
  });
  return { tables, entities: new Proxy({}, { get: (_t, name) => entity(name) }) };
}

const CLIENT = { id: 'c1', client_name: 'Sam Rivera', phone: '0412345678', suburb: 'Bexley', address: '12 Secret Street, Bexley', is_test: false, frequency: 'Monthly' };
const seed = (mode) => ({
  ReminderClient: [CLIENT],
  BookingRequest: [],
  Service: [{ id: 's1', name: 'Skin Fade', price: 45, duration_mins: 45, is_active: true }],
  MessagingSettings: [{ id: 'ms1', assistant_mode: mode, messaging_mode: 'live', campaign_booking_link: 'https://example.test/book' }],
});

const SLOTS = [{ label: '10:00am', start_decimal: 10 }, { label: '11:00am', start_decimal: 11 }, { label: '2:00pm', start_decimal: 14 }];
function fakeDeps(over = {}) {
  const calls = { search: 0, revalidate: [], create: [] };
  const deps = {
    loadStandIn: async () => ({ ok: true, booking: { id: undefined, team_member_id: 't1' }, body: {}, address_source: 'client_record' }),
    search: async () => { calls.search++; return { slots: SLOTS, duration_minutes: 45, reason: null }; },
    revalidate: async (_a, _s, date, start) => { calls.revalidate.push([date, start]); return { ok: true, stage: 'ok', label: SLOTS.find(s => s.start_decimal === start).label }; },
    create: async (_a, _s, assistant, token) => { calls.create.push({ assistant, token }); return { ok: true, id: 'bk-new' }; },
    searchExisting: async () => ({ date: '2026-10-16', slots: [], duration_minutes: 45 }),
    ...over,
  };
  return { deps, calls };
}

const friday = () => async () => ({ date_or_weekday: 'friday', earliest_time: '', latest_time: '', service_hint: '', confidence: 0.95 });
let n = 0;
const msg = (body, over = {}) => ({ sid: `SM${++n}`, from: '+61412345678', body, clients: [CLIENT], ownNumbers: ['0400000000'], now: NOW, ...over });
const run = (db, input, llm, deps) => handleInbound(db, input, { llm, enqueue: enqueueOutboxMessage, booking: deps });

test('a slot question offers only what the engine returned, and writes no booking', async () => {
  const db = makeDb(seed('draft')); const { deps, calls } = fakeDeps();
  const ev = await run(db, msg('What times do you have on Friday?'), friday(), deps);
  assert.equal(ev.outcome, 'drafted');
  assert.equal(calls.search, 1);
  for (const s of SLOTS) assert.ok(ev.draft_text.includes(s.label), s.label);
  assert.equal((db.tables.BookingRequest || []).length, 0);
  assert.equal(db.tables.AssistantConversation[0].status, 'drafting');
  assert.equal(calls.create.length, 0);
});

test('a model-written time is discarded: the offer is built from engine labels only', async () => {
  const db = makeDb(seed('draft')); const { deps } = fakeDeps();
  const llm = async () => ({ date_or_weekday: 'friday', earliest_time: '', latest_time: '', service_hint: '', confidence: 0.95, proposed_time: '3:15pm' });
  const ev = await run(db, msg('Any times Friday?'), llm, deps);
  assert.ok(!ev.draft_text.includes('3:15'));
});

test('accepting an offered time re-validates, then creates one booking with the promised time', async () => {
  const db = makeDb(seed('live')); const { deps, calls } = fakeDeps();
  const first = await run(db, msg('What times do you have on Friday?'), friday(), deps);
  assert.equal(first.outcome, 'queued');
  const second = await run(db, msg('2', { now: LATER }), friday(), deps);
  assert.equal(calls.revalidate.length, 1);
  assert.deepEqual(calls.revalidate[0], ['2026-10-16', 11]);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].assistant.assigned_time, '11:00am');
  assert.equal(second.booking_request_id, 'bk-new');
  assert.equal(db.tables.AssistantConversation[0].status, 'booked');
  assert.match(second.draft_text, /pencilled in/);
});

test('a slot that has gone is never booked: the customer is told and the engine is asked again', async () => {
  const db = makeDb(seed('live'));
  const { deps, calls } = fakeDeps({ revalidate: async () => ({ ok: false, stage: 'raced', reason: 'APPOINTMENT_OVERLAP' }) });
  await run(db, msg('What times do you have on Friday?'), friday(), deps);
  const second = await run(db, msg('1', { now: LATER }), friday(), deps);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.search, 2);
  assert.match(second.draft_text, /just gone/);
});

test('a stranger is never booked: they get the booking link', async () => {
  const db = makeDb(seed('draft')); const { deps, calls } = fakeDeps();
  const ev = await run(db, msg('What times do you have Friday?', { clients: [] }), friday(), deps);
  assert.equal(calls.search, 0);
  assert.equal(calls.create.length, 0);
  assert.match(ev.draft_text || '', /example\.test\/book/);
});

test('a client with no history gets the booking link, not a guessed booking', async () => {
  const db = makeDb(seed('draft'));
  const { deps, calls } = fakeDeps({ loadStandIn: async () => ({ ok: false, code: 'no_history', reason: 'No previous booking.' }) });
  const ev = await run(db, msg('What times do you have Friday?'), friday(), deps);
  assert.equal(calls.create.length, 0);
  assert.match(ev.draft_text, /example\.test\/book/);
});

test('with assistant_mode off, a slot question is escalated as before', async () => {
  const db = makeDb(seed('off')); const { deps, calls } = fakeDeps();
  const ev = await run(db, msg('What times do you have Friday?'), friday(), deps);
  assert.equal(ev.outcome, 'escalated');
  assert.equal(calls.search, 0);
});

test('the creator is the only way a booking is made, and it makes the booking pending and locked', () => {
  const live = readFileSync(new URL('../base44/shared/assistantBookingLive.ts', import.meta.url), 'utf8');
  assert.ok(!/BookingRequest\.(create|update|delete)/.test(live), 'the live wiring never writes a booking itself');
  const create = readFileSync(new URL('../base44/shared/publicBookingCreate.ts', import.meta.url), 'utf8');
  assert.match(create, /status: 'pending'/);
  assert.match(create, /schedule_status = assistant \? 'locked'/);
  const hook = readFileSync(new URL('../base44/functions/twilioInboundWebhook/entry.ts', import.meta.url), 'utf8');
  assert.match(hook, /booking: liveBookingDeps/);
});