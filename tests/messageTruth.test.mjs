// Messages that tell the customer the truth: edited-booking notice, the four templates' context,
// one pre-appointment text per booking and day, the stale-route warning, and the gates every new message still passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMemDb } from './helpers/memDb.mjs';
import { makeLooseDb } from './helpers/loadEntry.mjs';

const { bookingEditNotice } = await import('../base44/shared/bookingEditNotice.ts');
const { enqueueBookingEdited } = await import('../base44/shared/bookingLifecycle.ts');
const { bookingPayload } = await import('../base44/shared/bookingMessages.ts');
const { paymentLineFor } = await import('../base44/shared/bookingPaymentLine.ts');
const { renderTemplate } = await import('../base44/shared/messageRender.ts');
const defaults = await import('../base44/shared/messageTemplateDefaults.ts');
const route = await import('../base44/shared/routeMessageTemplates.ts');
const { rebookingContext, expectedFrequency } = await import('../base44/shared/rebookingContext.ts');
const { runArrivalTimes, arrivalKey } = await import('../base44/shared/arrivalTimes.ts');
const { runPreAppointmentReminders, reminderPayload } = await import('../base44/shared/preAppointmentReminder.ts');
const guard = await import('../base44/shared/preAppointmentGuard.ts');
const fp = await import('../base44/shared/routeFingerprint.ts');
const { recipientBlock } = await import('../base44/shared/recipientGuard.ts');
const { modeBlock } = await import('../base44/shared/messagingMode.ts');
const { quietHoursCheck } = await import('../base44/shared/messagingProtections.ts');
const { overdueJobs, staleRouteAlert, sydneyTomorrow, ROUTE_ALERT } = await import('../src/lib/jobOverdue.js');
const { TEMPLATE_META, validateBody, SAMPLE_VALUES } = await import('../src/lib/messageTemplateMeta.js');

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const DATE = '2026-10-16';
const rows = (db, template) => db.table('MessageOutbox').filter((r) => !template || r.template_key === template);
const liveOf = (db) => rows(db).filter((r) => ['arrival_time', 'booking_reminder'].includes(r.template_key) && !['suppressed', 'dead_letter'].includes(r.status));

const confirmed = (over = {}) => ({
  id: 'b1', client_id: 'c1', client_name: 'James Smith', phone: '0412345678', status: 'confirmed', schedule_status: 'confirmed',
  requested_date: DATE, availability_window: '2pm-7pm', services: ['Haircut'], price: 45, address: '12 Smith St, Bondi NSW 2026',
  team_member_id: 't1', is_test: false, notes: '', email: 'j@x.com', ...over,
});

// ── 1. An edited confirmed booking tells the customer ────────────────────────────────────────────
test('a different service at a different price notifies the customer and names both changes', async () => {
  const db = makeMemDb({ BookingRequest: [confirmed()] });
  const before = confirmed();
  const after = { ...before, services: ['Skin Fade'], price: 60 };
  const r = await enqueueBookingEdited(db.asServiceRole, before, after);
  assert.equal(r.queued, true);
  const row = rows(db, 'booking_edited');
  assert.equal(row.length, 1);
  assert.equal(row[0].payload.change, 'service is now Skin Fade and price is now $60.00');
  const text = renderTemplate(route.BOOKING_EDITED_BODY, row[0].payload);
  assert.equal(text.ok, true);
  assert.match(text.text, /service is now Skin Fade and price is now \$60\.00/);
  assert.match(text.text, /Friday 16 October/);
});

test('window and address changes are named too', () => {
  const n = bookingEditNotice(confirmed(), confirmed({ availability_window: '9am-12pm', address: '99 Other Rd, Manly NSW 2095' }));
  assert.deepEqual(n.fields, ['window', 'address']);
  assert.equal(n.change, 'window is now 9am-12pm and address is now 99 Other Rd, Manly NSW 2095');
});

test('a cosmetic edit notifies nobody: name, phone, email, notes, spelling, spacing, order, capitalisation', async () => {
  const db = makeMemDb({ BookingRequest: [confirmed()] });
  const b = confirmed();
  const cosmetic = [
    { client_name: 'Jaems Smith' }, { phone: '0499999999' }, { email: 'new@x.com' }, { notes: 'gate code 1234' },
    { availability_window: '2pm – 7pm' }, { availability_window: '2PM-7PM' },
    { address: '12 smith st bondi nsw 2026' }, { services: ['haircut'] }, { price: 45.001 },
  ];
  for (const c of cosmetic) {
    assert.equal(bookingEditNotice(b, { ...b, ...c }), null, JSON.stringify(c));
    assert.equal((await enqueueBookingEdited(db.asServiceRole, b, { ...b, ...c })).queued, false);
  }
  assert.equal(bookingEditNotice({ ...b, services: ['Haircut', 'Beard'] }, { ...b, services: ['Beard', 'Haircut'] }), null, 'order is not news');
  assert.equal(rows(db).length, 0);
});

test('only a confirmed booking is told: pending and finished bookings are not', () => {
  const change = { services: ['Skin Fade'], price: 60 };
  for (const status of ['pending', 'declined', 'completed', 'waitlist']) {
    assert.equal(bookingEditNotice(confirmed({ status }), confirmed({ status, ...change })), null, status);
  }
});

test('the same edit twice is one message; a different edit is a new one', async () => {
  const db = makeMemDb({ BookingRequest: [confirmed()] });
  const before = confirmed();
  const a = { ...before, services: ['Skin Fade'], price: 60 };
  await enqueueBookingEdited(db.asServiceRole, before, a);
  await enqueueBookingEdited(db.asServiceRole, before, a);
  await enqueueBookingEdited(db.asServiceRole, a, a); // the second tap after it already saved: nothing changed
  assert.equal(rows(db, 'booking_edited').length, 1);
  await enqueueBookingEdited(db.asServiceRole, a, { ...a, services: ['Beard Trim'], price: 30 });
  assert.equal(rows(db, 'booking_edited').length, 2);
});

test('the edit endpoint calls the notice after saving, and a failure cannot undo the edit', () => {
  const src = read('base44/functions/updateBookingRequest/entry.ts');
  assert.match(src, /import \{ enqueueBookingEdited \} from '\.\.\/\.\.\/shared\/bookingLifecycle\.ts'/);
  const save = src.indexOf('BookingRequest.update(booking.id');
  const notice = src.indexOf('enqueueBookingEdited(admin, booking');
  assert.ok(save > 0 && notice > save, 'the notice comes after the save');
  assert.match(src.slice(notice - 120, notice + 200), /try \{[\s\S]*catch/);
});

// ── 2. The context reaches the customer in the four messages ─────────────────────────────────────
const sample = confirmed({ services: ['Skin Fade', 'Beard Trim'] });

test('request received carries the service', () => {
  const r = renderTemplate(defaults.BOOKING_RECEIVED_BODY, bookingPayload(sample, 'booking_received'));
  assert.equal(r.ok, true);
  assert.match(r.text, /Skin Fade, Beard Trim/);
  assert.match(r.text, /Friday 16 October/);
});

test('confirmed carries the service, the address and the payment position', () => {
  const r = renderTemplate(defaults.BOOKING_CONFIRMED_BODY, bookingPayload(sample, 'booking_confirmed', '$45.00 due after your service.'));
  assert.equal(r.ok, true);
  assert.match(r.text, /Skin Fade, Beard Trim/);
  assert.match(r.text, /12 Smith St, Bondi NSW 2026/);
  assert.match(r.text, /\$45\.00 due after your service\./);
});

test('payment position is truthful for every state and never invents an amount', () => {
  const b = { price: 80, payment_status: 'Unpaid' };
  assert.equal(paymentLineFor(b, { state: 'paid_in_full', total_amount: 80, amount_paid: 80 }, null), 'Paid in full.');
  assert.equal(paymentLineFor(b, { state: 'deposit_due', total_amount: 80, deposit_amount: 25 }, null), 'A $25.00 deposit is needed to lock it in, sent in a separate text.');
  assert.equal(paymentLineFor(b, { state: 'deposit_paid', total_amount: 80, amount_paid: 25 }, null), 'Deposit paid, $55.00 due after your service.');
  assert.equal(paymentLineFor(b, { state: 'not_required', total_amount: 80, amount_paid: 0 }, null), '$80.00 due after your service.');
  assert.equal(paymentLineFor(b, null, { required: true, amount: 20 }), 'A $20.00 deposit is needed to lock it in, sent in a separate text.');
  assert.equal(paymentLineFor(b, null, null), '$80.00 due after your service.');
  assert.equal(paymentLineFor({ price: 0 }, null, null), 'Payment is due after your service.');
  assert.equal(paymentLineFor({ price: 80, payment_status: 'Paid' }, null, null), 'Paid in full.');
});

test('a booking with no address or service still renders, with a plain stand-in rather than a gap', () => {
  const p = bookingPayload({ client_name: 'Sam', requested_date: DATE, availability_window: 'Flexible' }, 'booking_confirmed');
  assert.equal(renderTemplate(defaults.BOOKING_CONFIRMED_BODY, p).ok, true);
  assert.equal(renderTemplate(defaults.BOOKING_RECEIVED_BODY, bookingPayload({ client_name: 'Sam', requested_date: DATE, availability_window: '2pm-7pm' }, 'booking_received')).ok, true);
});

const worldWithRoute = (over = {}) => {
  const rowsB = [confirmed({ assigned_time: '9:00am', duration_mins: 45, address_lat: -33.8, address_lng: 151.2, ...over })];
  return makeMemDb({
    BookingRequest: rowsB,
    DayRoute: [{ id: 'r1', date: DATE, route_status: 'finalised', team_member_id: 't1', is_test: false, fingerprint: fp.routeFingerprint(rowsB), stops: [{ booking_request_id: 'b1', order: 1, start_label: '9:00am', start_decimal: 9 }] }],
  });
};

test('the night-before arrival message carries the address', async () => {
  const db = worldWithRoute();
  await runArrivalTimes(db.asServiceRole, { date: DATE, trigger: 'scheduled' });
  const row = rows(db, 'arrival_time')[0];
  const r = renderTemplate(defaults.ARRIVAL_TIME_BODY, row.payload);
  assert.equal(r.ok, true);
  assert.match(r.text, /approximately 9:00am, at 12 Smith St, Bondi NSW 2026\./);
  assert.match(r.text, /Reply YES to confirm, or NO if you need to cancel or reschedule\./, "Alvaro's words are kept");
});

test('rebooking carries last visit and expected frequency when known, and omits what is only a default', () => {
  assert.deepEqual(rebookingContext({ last_visit_date: '2026-09-18', cadence_source: 'observed', cadence_interval_days: 28 }), { last_visit: 'Friday 18 September', frequency: 'about every 4 weeks' });
  assert.deepEqual(rebookingContext({ last_visit_date: '2026-09-18', frequency: 'Fortnightly', cadence_source: 'manual' }), { last_visit: 'Friday 18 September', frequency: 'every 2 weeks' });
  assert.equal(expectedFrequency({ frequency: 'Monthly', cadence_source: 'default' }), null, 'a system default is not a fact about the client');
  assert.equal(expectedFrequency({ frequency: 'Monthly' }), null, 'an unconfirmed bare Monthly is not either');
  assert.equal(expectedFrequency({ frequency: 'Whenever' }), null);
  assert.deepEqual(rebookingContext({}), {});
  // A wording that asks for a missing value is refused, so a gap can never be sent.
  assert.equal(renderTemplate('Last cut {{last_visit}}, {{frequency}}. {{booking_link}}', { booking_link: 'x', ...rebookingContext({}) }).ok, false);
  assert.match(read('base44/shared/campaignRun.ts'), /\.\.\.rebookingContext\(c\)/);
});

test("the rebooking wording is not changed: it is Alvaro's", () => {
  const src = read('base44/shared/messageTemplateDefaults.ts');
  assert.match(src, /DRAFT: Hi \{\{name\}\}, you're due for your next cut\. Book here: \{\{booking_link\}\}/);
  assert.ok(!/last_visit|frequency/.test(src));
});

test('every new body fits the SMS budget and every placeholder is a known variable', () => {
  const bodies = {
    booking_received: defaults.BOOKING_RECEIVED_BODY, booking_confirmed: defaults.BOOKING_CONFIRMED_BODY, arrival_time: defaults.ARRIVAL_TIME_BODY,
    booking_edited: route.BOOKING_EDITED_BODY, booking_reminder: route.BOOKING_REMINDER_BODY,
  };
  for (const [key, body] of Object.entries(bodies)) {
    const v = validateBody(key, body);
    assert.deepEqual(v.unknown, [], `${key} uses an unknown variable`);
    assert.deepEqual(v.missingRequired, [], key);
    const r = renderTemplate(body, SAMPLE_VALUES);
    assert.equal(r.ok, true, key);
    assert.ok(r.text.length <= 320, `${key} is ${r.text.length} characters: more than two SMS parts`);
  }
  assert.ok(TEMPLATE_META.booking_reminder && TEMPLATE_META.booking_edited);
});

test('only untouched defaults are upgraded; a hand-edited template is never overwritten', async () => {
  const edited = 'Hey {{name}}, your booking is confirmed for {{date}} ({{window}}). Alvaro.';
  const db = makeLooseDb({
    MessageTemplate: [
      { id: 't1', template_key: 'booking_received', body: defaults.BOOKING_RECEIVED_BODY_V1 },
      { id: 't2', template_key: 'booking_confirmed', body: edited },
      { id: 't3', template_key: 'arrival_time', body: defaults.ARRIVAL_TIME_BODY_V2 },
    ],
  });
  await route.ensureRouteTemplates(db.asServiceRole);
  const body = (id) => db.tables.MessageTemplate.find((t) => t.id === id).body;
  assert.equal(body('t1'), defaults.BOOKING_RECEIVED_BODY);
  assert.equal(body('t2'), edited);
  assert.equal(body('t3'), defaults.ARRIVAL_TIME_BODY);
  const keys = db.tables.MessageTemplate.map((t) => t.template_key);
  assert.ok(keys.includes('booking_edited') && keys.includes('booking_reminder'), 'the new templates are created when missing');
});

test('the automatic seeding creates every template the system sends, not just the route ones', async () => {
  // The outbox sweep, booking transitions and route stops all call ensureRouteTemplates.
  // seedMessageTemplates needs an admin to open the editor. If this function left the
  // booking templates out, a fresh install dead-lettered every booking_received and
  // booking_confirmed text until somebody visited Messages -> Templates.
  const db = makeLooseDb({ MessageTemplate: [] });
  const created = await route.ensureRouteTemplates(db.asServiceRole);
  for (const key of ['booking_received', 'booking_confirmed', 'booking_cancelled', 'no_show_followup', 'rebooking_reminder', 'rebooking_followup', 'arrival_time', 'booking_changed']) {
    assert.ok(created.includes(key), `${key} was not created`);
  }
  for (const t of route.ROUTE_TEMPLATES) assert.ok(created.includes(t.template_key), `${t.template_key} was not created`);
  const keys = db.tables.MessageTemplate.map((t) => t.template_key);
  assert.equal(new Set(keys).size, keys.length, 'a template key was created twice');
});

test('the two rebooking drafts are seeded switched off, so nothing is sent before Alvaro approves the words', async () => {
  const db = makeLooseDb({ MessageTemplate: [] });
  await route.ensureRouteTemplates(db.asServiceRole);
  const row = (k) => db.tables.MessageTemplate.find((t) => t.template_key === k);
  assert.equal(row('rebooking_reminder').is_active, false);
  assert.equal(row('rebooking_followup').is_active, false);
  assert.equal(row('booking_confirmed').is_active, true);
  assert.equal(row('on_the_way').is_active, true);
});

// ── 3. One pre-appointment message, finalised or not ─────────────────────────────────────────────
const unfinalised = (over = {}) => makeMemDb({ BookingRequest: [confirmed({ assigned_time: '9:00am', ...over })] });
const remind = (db, extra = {}) => runPreAppointmentReminders(db.asServiceRole, { date: DATE, ...extra });

test('arrival key format matches the one the guard reads', () => {
  assert.equal(arrivalKey('b1', DATE), 'sms|b1|arrival_time|2026-10-16');
  assert.equal(guard.reminderKey('b1', DATE), 'sms|b1|booking_reminder|2026-10-16');
});

test('a confirmed booking on a non-finalised route gets exactly one reminder, once', async () => {
  const db = unfinalised();
  const a = await remind(db); const b = await remind(db);
  assert.equal(a.queued, 1); assert.equal(b.queued, 0);
  assert.equal(rows(db, 'booking_reminder').length, 1);
  assert.equal(rows(db, 'arrival_time').length, 0);
});

test('a route that changed since it was finalised also gets the reminder, and the arrival job refuses', async () => {
  const db = worldWithRoute();
  db.table('BookingRequest')[0].assigned_time = '10:00am'; // the day moved after finalising
  await runArrivalTimes(db.asServiceRole, { date: DATE, trigger: 'scheduled' });
  assert.equal(rows(db, 'arrival_time').length, 0);
  await remind(db);
  assert.equal(rows(db, 'booking_reminder').length, 1);
  assert.equal(liveOf(db).length, 1);
});

test('a confirmed booking on a finalised route gets the arrival time and never the reminder', async () => {
  const db = worldWithRoute();
  await runArrivalTimes(db.asServiceRole, { date: DATE, trigger: 'scheduled' });
  const r = await remind(db);
  assert.equal(rows(db, 'arrival_time').length, 1);
  assert.equal(rows(db, 'booking_reminder').length, 0);
  assert.equal(r.left_to_arrival_time, 1);
  assert.equal((await remind(db, { dryRun: true })).would_queue, 0);
});

test('reminder first, route finalised later: an unsent reminder is replaced by the exact time', async () => {
  const db = worldWithRoute();
  const draftRoute = db.table('DayRoute')[0]; const finalised = { ...draftRoute };
  draftRoute.route_status = 'draft';
  await remind(db);
  assert.equal(rows(db, 'booking_reminder').length, 1);
  Object.assign(draftRoute, finalised);
  await runArrivalTimes(db.asServiceRole, { date: DATE, trigger: 'finalise' });
  assert.equal(rows(db, 'booking_reminder')[0].status, 'suppressed');
  assert.match(rows(db, 'booking_reminder')[0].suppressed_reason, /exact arrival time/);
  assert.equal(liveOf(db).length, 1);
  assert.equal(liveOf(db)[0].template_key, 'arrival_time');
});

test('reminder already sent, route finalised later: no second pre-appointment text', async () => {
  const db = worldWithRoute();
  const route0 = db.table('DayRoute')[0]; const finalised = { ...route0 };
  route0.route_status = 'draft';
  await remind(db);
  rows(db, 'booking_reminder')[0].status = 'sent';
  Object.assign(route0, finalised);
  const run = await runArrivalTimes(db.asServiceRole, { date: DATE, trigger: 'finalise' });
  assert.equal(rows(db, 'arrival_time').length, 0);
  assert.equal(run.routes[0].results[0].result, 'skipped');
  assert.equal(liveOf(db).length, 1);
  assert.equal(liveOf(db)[0].template_key, 'booking_reminder');
});

test('a race that leaves both rows is repaired so only one can reach the customer', async () => {
  for (const [reminderStatus, arrivalStatus, expectLive, action] of [
    ['pending', 'pending', 'arrival_time', 'reminder_suppressed'],
    ['sent', 'pending', 'booking_reminder', 'arrival_suppressed'],
    ['pending', 'sent', 'arrival_time', 'reminder_suppressed'],
  ]) {
    const db = makeMemDb({ BookingRequest: [confirmed()], MessageOutbox: [
      { id: 'o1', template_key: 'booking_reminder', booking_request_id: 'b1', idempotency_key: guard.reminderKey('b1', DATE), status: reminderStatus },
      { id: 'o2', template_key: 'arrival_time', booking_request_id: 'b1', idempotency_key: arrivalKey('b1', DATE), status: arrivalStatus },
    ] });
    assert.equal(await guard.reconcilePreAppointment(db.asServiceRole, 'b1', DATE), action, `${reminderStatus}/${arrivalStatus}`);
    assert.deepEqual(liveOf(db).map((r) => r.template_key), [expectLive]);
  }
  const both = makeMemDb({ BookingRequest: [confirmed()], MessageOutbox: [
    { id: 'o1', template_key: 'booking_reminder', booking_request_id: 'b1', idempotency_key: guard.reminderKey('b1', DATE), status: 'sent' },
    { id: 'o2', template_key: 'arrival_time', booking_request_id: 'b1', idempotency_key: arrivalKey('b1', DATE), status: 'sent' },
  ] });
  assert.equal(await guard.reconcilePreAppointment(both.asServiceRole, 'b1', DATE), 'both_reached', 'reported, never hidden');
});

test('the reminder never states an arrival time: only the date, the customer\'s own window and the address', async () => {
  for (const window of ['Flexible', '2pm-7pm']) {
    const b = confirmed({ assigned_time: '9:00am', availability_window: window });
    const r = renderTemplate(route.BOOKING_REMINDER_BODY, reminderPayload(b));
    assert.equal(r.ok, true);
    assert.ok(!/9(:00)?\s?am/i.test(r.text), `stored time leaked: ${r.text}`);
    if (window === 'Flexible') {
      assert.match(r.text, /sometime during the day/);
      assert.ok(!/\d\s?(am|pm)/i.test(r.text), `no clock time at all: ${r.text}`);
    } else {
      assert.match(r.text, /between 2pm-7pm/);
    }
    assert.match(r.text, /12 Smith St/);
    assert.match(r.text, /tomorrow, Friday 16 October/);
  }
  const overridden = reminderPayload(confirmed({ availability_override: true, assigned_time: '9:00am' }));
  assert.equal(overridden.window_phrase, 'sometime during the day', 'an admin override is not the window the customer agreed to');
  assert.ok(!('time' in reminderPayload(confirmed())));
  assert.ok(!/assigned_time|start_label|start_decimal/.test(read('base44/shared/preAppointmentReminder.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
});

test('only confirmed bookings with a phone number are reminded', async () => {
  const db = makeMemDb({ BookingRequest: [
    confirmed({ id: 'p', status: 'pending' }), confirmed({ id: 'n', phone: '' }), confirmed({ id: 'h', protection_hold: true }),
    confirmed({ id: 'k', client_name: '[BLOCK] lunch', status: 'blocked' }), confirmed({ id: 'ok' }),
  ] });
  await remind(db);
  assert.deepEqual(rows(db, 'booking_reminder').map((r) => r.booking_request_id), ['ok']);
});

// ── 4. The barber is told when arrival texts have stopped ────────────────────────────────────────
test('a changed route produces a visible warning that names the consequence', () => {
  const alert = staleRouteAlert({ status: 'needs_update' }, DATE);
  assert.equal(alert.kind, 'route');
  assert.equal(alert.name, "Tomorrow's route has changed.");
  assert.equal(alert.consequence, 'Arrival times will not be sent until you rebuild it.');
  assert.equal(alert.key, `route:${DATE}`);
  for (const status of ['finalised', 'draft', 'finalising', undefined]) assert.equal(staleRouteAlert({ status }, DATE), null, String(status));
  assert.equal(staleRouteAlert(null, DATE), null);
  assert.deepEqual(ROUTE_ALERT, { name: alert.name, consequence: alert.consequence });
});

test("tomorrow is Sydney's tomorrow, across the date line and daylight saving", () => {
  assert.equal(sydneyTomorrow(Date.parse('2026-10-16T02:00:00Z')), '2026-10-17'); // 13:00 Friday in Sydney
  assert.equal(sydneyTomorrow(Date.parse('2026-10-16T14:30:00Z')), '2026-10-18'); // 01:30 Saturday in Sydney
});

test('it reuses the existing banner and badge, and is checked on every admin page without opening the calendar', () => {
  const layout = read('src/components/admin/AdminSidebarLayout.jsx');
  assert.match(layout, /const overdue = useOverdueJobs\(\)/);
  assert.match(layout, /<OverdueJobsBanner jobs=\{overdue\} \/>/);
  assert.match(layout, /overdueCount=\{overdue\.length\}/);
  const hook = read('src/hooks/useOverdueJobs.js');
  assert.match(hook, /staleRouteAlert\(await loadDayRouteState\(date\), date\)/);
  assert.match(hook, /setInterval\(load, 60000\)/);
  assert.match(read('src/components/automation/OverdueJobsBanner.jsx'), /\{r\.name\}<\/span> \{r\.consequence\}/);
  assert.ok(!existsSecondBanner(), 'no second notification system');
  // the existing overdue-job behaviour is untouched
  assert.equal(overdueJobs({ beats: {} }).length, 3);
});
function existsSecondBanner() {
  return /RouteChangedBanner|StaleRouteBanner/.test(read('src/components/admin/AdminSidebarLayout.jsx'));
}

// ── 5. Every new message still passes every gate ─────────────────────────────────────────────────
const NEW = ['booking_edited', 'booking_reminder'];

test('test data, STOP and declined consent suppress the new messages exactly as they do the old ones', async () => {
  for (const template_key of NEW) {
    const item = { template_key, channel: 'sms', to_address: '0412345678', booking_request_id: 'b1', client_id: 'c1' };
    const world = (booking, client) => makeMemDb({ BookingRequest: [{ ...confirmed(), ...booking }], ReminderClient: [{ id: 'c1', client_name: 'James', phone: '0412345678', ...client }] }).asServiceRole;
    assert.equal(await recipientBlock(world({ is_test: true }, {}), item), 'test data', template_key);
    assert.equal(await recipientBlock(world({}, { is_test: true }), item), 'test data', template_key);
    assert.equal(await recipientBlock(world({}, { messaging_opted_out: true }), item), 'opted out', template_key);
    assert.equal(await recipientBlock(world({ messaging_consent: false }, {}), item), 'no messaging consent', template_key);
    assert.equal(await recipientBlock(world({}, {}), item), null, template_key);
  }
});

test('messaging mode and quiet hours block the new messages; the sweep has no way round them', () => {
  const item = { channel: 'sms', to_address: '0412345678' };
  assert.ok(modeBlock({ mode: 'off', allowlist: new Set() }, item));
  assert.ok(modeBlock({ mode: 'allowlist', allowlist: new Set(['0499999999']) }, item));
  assert.equal(modeBlock({ mode: 'live', allowlist: new Set() }, item), null);
  assert.equal(quietHoursCheck(new Date('2026-10-16T10:00:00Z')).quiet, true, '21:00 Sydney is quiet');
  assert.equal(quietHoursCheck(new Date('2026-10-16T02:00:00Z')).quiet, false, '13:00 Sydney is not');
  const sweep = read('base44/functions/processMessageOutbox/entry.ts');
  for (const k of NEW) assert.ok(!sweep.includes(k), `the sweep never special-cases ${k}`);
  assert.match(sweep, /is_manual !== true/, 'only manual sends are exempt from quiet hours');
  // The new code only ever enqueues; it never reaches a provider.
  for (const f of ['preAppointmentReminder.ts', 'preAppointmentGuard.ts', 'bookingEditNotice.ts', 'rebookingContext.ts']) {
    assert.ok(!/from '[^']*(twilio|sender|providers)[^']*'|fetch\(/i.test(read(`base44/shared/${f}`)), f);
  }
});

test('the six scheduling engines are untouched by this work', () => {
  for (const f of ['schedulingValidator', 'reshuffleEngine', 'routeFlowOptimiser', 'routeFlowEngine', 'dayRoute', 'appointmentTiming']) {
    for (const mod of ['bookingEditNotice', 'preAppointmentReminder', 'preAppointmentGuard', 'rebookingContext', 'bookingPaymentLine']) {
      assert.ok(!read(`base44/shared/${mod}.ts`).includes(`${f}.ts`), `${mod} must not import ${f}`);
    }
  }
});