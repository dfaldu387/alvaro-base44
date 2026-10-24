// Deterministic tests for the messaging safety rules. No network, no database,
// no Twilio, no real messages. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReply, quietHoursCheck, OPT_OUT_KEYWORDS } from '../base44/shared/messagingProtections.ts';
import { classifyArrivalReply } from '../base44/shared/arrivalReplies.ts';
import { renderTemplate } from '../base44/shared/messageRender.ts';
import { computeTwilioSignature, verifyTwilioSignature } from '../base44/shared/twilio.ts';
import { arrivalKey, sydneyNow, addDays } from '../base44/shared/arrivalTimes.ts';
import { isCanonicalRow } from '../base44/shared/outboxCanonical.ts';
import { targetFromProvider, deliveryUpdate, mergeRecorded } from '../base44/shared/deliveryStatus.ts';
import { enqueueOutboxMessage } from '../base44/shared/outboxEnqueue.ts';

test('STOP-type words opt out; START opts in', () => {
  for (const w of ['STOP', 'stop', ' Stop ', 'STOPALL', 'UNSUBSCRIBE', 'END', 'QUIT']) assert.equal(classifyReply(w), 'opt_out', w);
  for (const w of ['START', 'unstop']) assert.equal(classifyReply(w), 'opt_in', w);
  assert.equal(classifyReply('please stop'), 'other');
});

test('CANCEL is NOT an opt-out: it only flags the booking', () => {
  assert.equal(classifyReply('CANCEL'), 'other');
  assert.ok(!OPT_OUT_KEYWORDS.includes('CANCEL'));
  assert.equal(classifyArrivalReply('CANCEL'), 'needs_attention');
});

test('arrival replies: YES confirms, NO / RESCHEDULE flag, anything else goes to a human', () => {
  for (const w of ['YES', 'y', 'Yep', 'CONFIRM']) assert.equal(classifyArrivalReply(w), 'customer_confirmed', w);
  for (const w of ['NO', 'no', 'RESCHEDULE']) assert.equal(classifyArrivalReply(w), 'needs_attention', w);
  for (const w of ['yes please', 'maybe', '', null, undefined, 42]) assert.equal(classifyArrivalReply(w), 'other', String(w));
  assert.equal(classifyArrivalReply('STOP'), 'other');
});

test('quiet hours are 08:00-20:00 Sydney, correct on both sides of daylight saving', () => {
  const quiet = (iso) => quietHoursCheck(new Date(iso)).quiet;
  // AEST (+10) before DST starts (Sydney clocks go forward at 02:00 on 2026-10-04)
  assert.equal(quiet('2026-10-01T21:59:00Z'), true);   // 07:59 AEST on 2 Oct
  assert.equal(quiet('2026-10-01T22:00:00Z'), false);  // 08:00 AEST on 2 Oct
  // The first morning on AEDT (+11): 08:00 is 21:00Z the day before
  assert.equal(quiet('2026-10-03T20:59:00Z'), true);   // 07:59 AEDT on 4 Oct
  assert.equal(quiet('2026-10-03T21:00:00Z'), false);  // 08:00 AEDT on 4 Oct
  assert.equal(quiet('2026-10-13T08:59:00Z'), false);  // 19:59 AEDT
  assert.equal(quiet('2026-10-13T09:00:00Z'), true);   // 20:00 AEDT
  // A held message resumes at the next 08:00 Sydney
  const v = quietHoursCheck(new Date('2026-10-13T09:00:00Z'));
  assert.equal(v.quiet, true);
  assert.equal(v.resumeAt, '2026-10-13T21:00:00.000Z');
});

test('arrival key is per booking and per service date; Sydney date maths is stable', () => {
  assert.equal(arrivalKey('abc', '2026-10-14'), 'sms|abc|arrival_time|2026-10-14');
  assert.notEqual(arrivalKey('abc', '2026-10-14'), arrivalKey('abc', '2026-10-15'));
  assert.equal(sydneyNow(new Date('2026-10-13T14:30:00Z')).date, '2026-10-14'); // already tomorrow in Sydney
  assert.equal(addDays('2026-10-03', 1), '2026-10-04');
});

test('templates: missing, blank and unknown values refuse to render', () => {
  assert.deepEqual(renderTemplate('Hi {{name}}, {{time}}', { name: 'Sam', time: '2:30pm' }), { ok: true, text: 'Hi Sam, 2:30pm' });
  for (const payload of [{ name: 'Sam' }, { name: 'Sam', time: '  ' }, { name: 'Sam', time: null }, null]) {
    const r = renderTemplate('Hi {{name}}, {{time}}', payload);
    assert.equal(r.ok, false);
  }
  assert.equal(renderTemplate('', {}).ok, false);
  assert.equal(renderTemplate('Hi {{name}}', { name: '{{time}}' }).ok, false); // no second-pass expansion
});

test('Twilio signature: valid passes; tampered body, wrong token and missing header fail', async () => {
  const url = 'https://example.test/hook';
  const params = { MessageSid: 'SM1', MessageStatus: 'delivered' };
  const sig = await computeTwilioSignature('token', url, params);
  assert.equal(await verifyTwilioSignature('token', sig, [url], params), true);
  assert.equal(await verifyTwilioSignature('token', sig, [url], { ...params, MessageStatus: 'failed' }), false);
  assert.equal(await verifyTwilioSignature('other', sig, [url], params), false);
  assert.equal(await verifyTwilioSignature('token', null, [url], params), false);
  assert.equal(await verifyTwilioSignature('token', 'garbage', [url], params), false);
});

test('status callbacks: only delivered / failed matter, delivered is final, order does not matter', () => {
  assert.equal(targetFromProvider('Delivered'), 'delivered');
  assert.equal(targetFromProvider('undelivered'), 'failed');
  for (const s of ['queued', 'sending', 'sent', '', undefined]) assert.equal(targetFromProvider(s), null, String(s));
  assert.equal(mergeRecorded('delivered', 'failed'), 'delivered');
  assert.equal(mergeRecorded('failed', 'delivered'), 'delivered');
  assert.equal(mergeRecorded(undefined, 'failed'), 'failed');
  // A recorded callback is applied to the Message once it exists, never downgrading delivered.
  assert.ok(deliveryUpdate('delivered').from.includes('sent'));
  assert.ok(!deliveryUpdate('failed').from.includes('delivered'));
  assert.equal(deliveryUpdate('failed', '30003').set.delivery_error, '30003');
  assert.equal(deliveryUpdate(undefined), null);
});

test('only the oldest outbox row for a key is canonical', () => {
  const a = { id: 'a', created_date: '2026-10-13T01:00:00Z' };
  const b = { id: 'b', created_date: '2026-10-13T01:00:01Z' };
  assert.equal(isCanonicalRow(a, [a, b]), true);
  assert.equal(isCanonicalRow(b, [a, b]), false);
  const t1 = { id: 'x', created_date: 'same' };
  const t2 = { id: 'y', created_date: 'same' };
  assert.equal(isCanonicalRow(t1, [t1, t2]), true);   // tie broken by id, same answer for both writers
  assert.equal(isCanonicalRow(t2, [t1, t2]), false);
});

// A tiny in-memory stand-in for the entity layer.
function fakeAdmin() {
  const rows = []; let n = 0;
  const known = { BookingRequest: { b1: { id: 'b1', is_test: false } }, ReminderClient: { c1: { id: 'c1', is_test: false } } };
  const match = (r, q) => Object.entries(q).every(([k, v]) => r[k] === v);
  return {
    rows,
    entities: {
      BookingRequest: { get: async (id) => known.BookingRequest[id] },
      ReminderClient: { get: async (id) => known.ReminderClient[id] },
      Message: { get: async () => null },
      MessageOutbox: {
        filter: async (q) => rows.filter(r => match(r, q)).map(r => ({ ...r })),
        create: async (d) => { const r = { ...d, id: `r${++n}`, created_date: new Date(Date.UTC(2026, 9, 13, 0, 0, 0, n)).toISOString() }; rows.push(r); return { ...r }; },
        delete: async (id) => { rows.splice(rows.findIndex(r => r.id === id), 1); },
      },
    },
  };
}
const input = (key) => ({ channel: 'sms', to_address: '0412345678', template_key: 'booking_confirmed', booking_request_id: 'b1', client_id: 'c1', idempotency_key: key });

test('simultaneous enqueue with one key leaves exactly one row', async () => {
  const admin = fakeAdmin();
  const results = await Promise.all([1, 2, 3, 4].map(() => enqueueOutboxMessage(admin, input('sms|b1|booking_confirmed'))));
  assert.ok(results.every(r => r.ok));
  assert.equal(admin.rows.length, 1);
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(new Set(results.map(r => r.message_outbox.id)).size, 1);
});

test('a repeated enqueue returns the existing row; different keys stay separate; bad keys are refused', async () => {
  const admin = fakeAdmin();
  const first = await enqueueOutboxMessage(admin, input('sms|b1|booking_confirmed'));
  const again = await enqueueOutboxMessage(admin, input('sms|b1|booking_confirmed'));
  assert.equal(again.created, false);
  assert.equal(again.message_outbox.id, first.message_outbox.id);
  await enqueueOutboxMessage(admin, input('sms|b1|booking_cancelled'));
  assert.equal(admin.rows.length, 2);
  for (const key of ['', 'sms|b1', 'email|b1|booking_confirmed', 'sms||x']) {
    assert.equal((await enqueueOutboxMessage(admin, input(key))).ok, false, key);
  }
});