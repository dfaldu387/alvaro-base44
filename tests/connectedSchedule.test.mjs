// Connected scheduling: a flexible appointment starts when the one before it
// finishes, plus the road time between the two customers — nothing else added.
//
//   Appointment 1  9:45am–10:20am   (confirmed, so it anchors the day)
//   drive          15 min
//   Appointment 2  10:35am          ← not 10:55am
//
// Also covers the three-way protection rule: flexible and manually placed
// appointments stay optimisable; a time the customer already has does not.
//
// Pure-function tests — no browser, no database, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainDay } from '../base44/shared/connectedSchedule.ts';
import { evaluateSchedule } from '../base44/shared/reshuffleEngine.ts';
import { automationClass, isFixedForAutomation } from '../base44/shared/provisionalPlacement.ts';

/** Decimal hours from a clock label, for readable expectations. */
const h = (hhmm) => {
  const [hh, mm] = String(hhmm).split(':').map(Number);
  return hh + (mm || 0) / 60;
};
const label = (dec) => {
  const total = Math.round(dec * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  const suffix = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')}${suffix}`;
};

const item = (id, start, durationMins, extra = {}) => ({
  id,
  start,
  durationHours: durationMins / 60,
  windowStart: null,
  windowEnd: null,
  anchor: false,
  block: false,
  ...extra,
});

const DAY = { workStart: h('07:00'), workEnd: h('17:00') };

test('the next flexible appointment starts at the finish plus the drive — 10:35, not 10:55', () => {
  const items = [
    item('a1', h('09:45'), 35, { anchor: true }),
    item('a2', h('10:55'), 35),
  ];
  const res = chainDay(items, { ...DAY, driveFor: () => 15 });
  assert.equal(label(res.assigned.get('a2')), '10:35am');
  assert.deepEqual(res.moved, ['a2']);
  // The 20 wasted minutes are gone: the chain leaves no idle time at all.
  assert.equal(res.idleMinutes, 0);
  assert.equal(res.driveMinutes, 15);
});

test('moving the first appointment recalculates every flexible appointment after it', () => {
  const drive = () => 15;
  const items = [
    item('a1', h('09:45'), 35, { anchor: true }),
    item('a2', h('10:55'), 35),
    item('a3', h('11:40'), 30),
  ];
  const before = chainDay(items, { ...DAY, driveFor: drive });
  assert.equal(label(before.assigned.get('a2')), '10:35am');
  // a2 finishes 11:10 + 15 min drive = 11:25
  assert.equal(label(before.assigned.get('a3')), '11:25am');

  // The barber moves the first appointment 45 minutes later; both downstream
  // appointments follow it without being touched themselves.
  const moved = [items[0], items[1], items[2]].map(i => (i.id === 'a1' ? { ...i, start: h('10:30') } : i));
  const after = chainDay(moved, { ...DAY, driveFor: drive });
  assert.equal(label(after.assigned.get('a2')), '11:20am');
  assert.equal(label(after.assigned.get('a3')), '12:10pm');
});

test('a flexible appointment is never pulled in front of the day’s first fixed appointment', () => {
  const items = [
    item('a1', h('09:45'), 35, { anchor: true }),
    item('a2', h('10:55'), 30),
  ];
  // A zero-cost matrix made "park it at 7am" look free before; the chain starts
  // at the anchor, so the appointment follows it instead of splitting the day.
  const res = chainDay(items, { ...DAY, driveFor: () => 0 });
  assert.equal(label(res.assigned.get('a2')), '10:20am');
  assert.ok(res.assigned.get('a2') > h('09:45'));
});

test('chaining stops at a time the customer already has, and resumes after it', () => {
  const items = [
    item('a1', h('09:45'), 35, { anchor: true }),
    item('a2', h('10:55'), 35),
    // Confirmed with the client: it anchors, and everything after it chains from it.
    item('a3', h('12:30'), 30, { anchor: true }),
    item('a4', h('14:00'), 30),
  ];
  const res = chainDay(items, { ...DAY, driveFor: () => 15 });
  assert.equal(label(res.assigned.get('a2')), '10:35am');
  assert.equal(label(res.assigned.get('a3')), '12:30pm'); // untouched
  assert.equal(label(res.assigned.get('a4')), '1:15pm'); // 12:30 + 30 + 15
});

test('a drive that does not divide by five is rounded up, but only to the calendar’s increment', () => {
  const items = [item('a1', h('09:45'), 35, { anchor: true }), item('a2', h('10:55'), 30)];
  const res = chainDay(items, { ...DAY, driveFor: () => 7 });
  // 10:20 + 7 = 10:27 → 10:30. The drive itself is never rounded up to 15 or 30.
  assert.equal(label(res.assigned.get('a2')), '10:30am');
});

test('a chained time stays inside the customer’s own availability window', () => {
  const items = [
    item('a1', h('09:45'), 35, { anchor: true }),
    item('a2', h('10:55'), 30, { windowStart: h('12:00'), windowEnd: h('15:00') }),
  ];
  const res = chainDay(items, { ...DAY, driveFor: () => 15 });
  assert.equal(label(res.assigned.get('a2')), '12:00pm');
});

test('the drive to the next fixed appointment is never eaten', () => {
  const items = [
    item('a1', h('09:45'), 35, { anchor: true }),
    item('a2', h('10:55'), 50),
    // Only 20 minutes of room before this confirmed appointment.
    item('a3', h('11:25'), 30, { anchor: true }),
  ];
  const res = chainDay(items, { ...DAY, driveFor: () => 15 });
  // 10:35 → but a3 needs 15 minutes of drive before 11:25, so a2 cannot sit there.
  assert.ok(res.unplaced.includes('a2'));
  assert.equal(res.assigned.get('a2'), undefined);
});

test('blocked time is occupied: a chained appointment never lands inside it', () => {
  const items = [
    item('a1', h('09:45'), 35, { anchor: true }),
    item('brk', h('10:30'), 60, { anchor: true, block: true }),
    item('a2', h('13:00'), 30),
  ];
  const res = chainDay(items, { ...DAY, driveFor: () => 15 });
  // 10:20 + 15 = 10:35 is inside the break, so the chain resumes after it.
  assert.equal(label(res.assigned.get('a2')), '11:30am');
});

test('travel is never padded: 9:55 service end + a 15-minute drive starts the next appointment at 10:10', () => {
  // The 5-minute scheduling increment is applied once, to the start. A 15-minute
  // drive after a 9:55 finish must land exactly on 10:10, never on 10:15.
  const res = chainDay([item('b1', h('09:20'), 35), item('b2', h('10:15'), 35)], { ...DAY, driveFor: () => 15, anchorFirst: true });
  assert.equal(label(res.assigned.get('b2')), '10:10am');
  // Nor is a real road time rounded up to a 5-minute mark before it is used:
  // a 12-minute drive arrives at 10:07 and the next start is the 10:10 mark.
  const odd = chainDay([item('c1', h('09:20'), 35), item('c2', h('10:15'), 35)], { ...DAY, driveFor: () => 12, anchorFirst: true });
  assert.equal(label(odd.assigned.get('c2')), '10:10am');
});

test('Connect chains the example from the brief: 9:00–10:15, drive 20 → 10:35, drive 15 → 11:25', () => {
  // Connect is order-preserving: the first appointment anchors the day even
  // though nothing has been confirmed yet.
  const items = [
    item('a1', h('09:00'), 75),
    item('a2', h('11:40'), 35),
    item('a3', h('14:00'), 35),
  ];
  const res = chainDay(items, { ...DAY, driveFor: () => 20, anchorFirst: true });
  assert.equal(label(res.assigned.get('a1')), '9:00am'); // the anchor keeps its time
  assert.equal(label(res.assigned.get('a2')), '10:35am'); // 10:15 + 20
  assert.equal(label(res.assigned.get('a3')), '11:30am'); // 11:10 + 20
  assert.equal(res.idleMinutes, 0);

  // A 15-minute second leg lands at 11:25, exactly as the brief describes.
  const second = chainDay(items, {
    ...DAY,
    driveFor: (from) => (from === 'a2' ? 15 : 20),
    anchorFirst: true,
  });
  assert.equal(label(second.assigned.get('a3')), '11:25am');
});

test('Connect never re-orders: a later appointment is not pulled in front of an earlier one', () => {
  const items = [
    item('a1', h('13:00'), 30),
    item('a2', h('09:00'), 30), // sits earlier, but the barber chose a1 first? no — time decides
    item('a3', h('15:00'), 30),
  ];
  // The chain follows the calendar's own order (the times on the day), so the
  // earliest appointment anchors and the rest follow it.
  const res = chainDay(items, { ...DAY, driveFor: () => 10, anchorFirst: true });
  assert.equal(label(res.assigned.get('a2')), '9:00am');
  assert.equal(label(res.assigned.get('a1')), '9:40am'); // 9:30 + 10
  assert.equal(label(res.assigned.get('a3')), '10:20am'); // 10:10 + 10
});

// ── Who may be moved by automation ─────────────────────────────────────────

test('a time the customer has is fixed; a time the barber dragged is not', () => {
  // Nothing decided: fully flexible.
  assert.equal(automationClass({ schedule_status: null }), 'flexible');
  assert.equal(isFixedForAutomation({ schedule_status: 'unscheduled' }), false);

  // The barber positioned it manually and nobody has been told: still optimisable.
  assert.equal(automationClass({ schedule_status: 'provisional' }), 'manual');
  assert.equal(isFixedForAutomation({ schedule_status: 'provisional' }), false);

  // Confirmed with the client.
  assert.equal(automationClass({ schedule_status: 'confirmed' }), 'communicated');
  assert.equal(isFixedForAutomation({ schedule_status: 'confirmed' }), true);

  // Deliberately locked by the barber.
  assert.equal(isFixedForAutomation({ schedule_status: 'locked' }), true);

  // Asked to confirm an out-of-availability time: communicated, not yet agreed.
  assert.equal(isFixedForAutomation({ schedule_status: 'provisional', availability_override: true, override_status: 'awaiting_confirmation' }), true);
  assert.equal(isFixedForAutomation({ schedule_status: 'provisional', availability_override: true, override_status: 'confirmed' }), true);

  // A leftover override flag with no confirmation status is not a promise to anyone.
  assert.equal(isFixedForAutomation({ schedule_status: 'provisional', availability_override: true, override_status: 'none' }), false);
});

test('a manual move never confirms or locks an appointment, and a moved confirmed time stays flagged', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../base44/functions/applyManualPlacement/entry.ts', import.meta.url), 'utf8');
  // A move is planning: it never writes a confirmed or locked state.
  assert.ok(!/schedule_status: 'locked'/.test(src), 'a manual placement must never lock the appointment');
  assert.ok(!/schedule_status: 'confirmed'/.test(src), 'a manual placement must never confirm the appointment');
  // A time the client already holds is not silently demoted either: it is flagged.
  assert.ok(!/schedule_status: 'provisional' \}\)/.test(src), 'a confirmed appointment must not be silently demoted');
  assert.match(src, /notification_pending: clientNeedsNotice/);
});

test('Connect Appointments never confirms a booking or sends a message', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../base44/functions/finaliseRoute/entry.ts', import.meta.url), 'utf8');
  assert.ok(!/confirmBookingCore/.test(src), 'connecting must not confirm bookings');
  assert.ok(!/runArrivalOnFinalise/.test(src), 'connecting must not queue arrival messages');
  assert.ok(!/enqueueMessage|SendEmail|twilio/i.test(src), 'connecting must not send anything');
});

test('Connect chains the day in the arranged order instead of re-optimising it', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../base44/shared/dayRoute.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ chainDay \} from '\.\/connectedSchedule\.ts'/);
  assert.match(src, /anchorFirst: true/);
  assert.ok(!/evaluateSchedule\(/.test(src), 'connecting must not run the order optimiser');
});

// ── Source guards: the wiring stays in place ───────────────────────────────

test('the optimiser starts from the connected seed and can reach the chained time', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../base44/shared/reshuffleEngine.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ chainDay \} from '\.\/connectedSchedule\.ts'/);
  assert.match(src, /function connectedSeed\(/);
  // The chained time joins each appointment's own slot list.
  assert.match(src, /const chained = connected\.get\(it\.id\)/);
  // And the chain is a seed the search evaluates.
  assert.match(src, /new Map\(currentAssign\),\s*\n\s*\/\/[\s\S]{0,200}\n\s*connected,/);
});

test('Route Flow decides movement with the shared three-way rule, not its own copy', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../base44/shared/routeFlowOptimiser.ts', import.meta.url), 'utf8');
  assert.match(src, /isFixedForAutomation\(r\)/);
});