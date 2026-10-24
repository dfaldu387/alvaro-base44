// Static checks over the source: authorization on every backend function, the
// simulated-by-default sender, and the browser-side booking paths. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const functions = readdirSync(new URL('base44/functions/', root), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name)
  .filter(n => { try { read(`base44/functions/${n}/entry.ts`); return true; } catch { return false; } });

// Documented exceptions. Anything not listed here must show an admin/staff gate.
const WEBHOOK_SIGNATURE = ['twilioInboundWebhook', 'twilioStatusWebhook'];
const SQUARE_WEBHOOK = ['squareWebhook']; // verified by tests/squarePayments.test.mjs
const PUBLIC_BY_DESIGN = ['submitPublicBooking', 'publicBookingData', 'publicDepositQuote', 'publicHomepageData', 'submitGroupEnquiry', 'checkBookingStatus', 'getBookingTracking', 'acceptStaffInvite', 'validateStaffInvite'];
const RETIRED_STUBS = ['routeFlowAutoPlace', 'routeFlowApplyReshuffle', 'routeFlowEvaluateReshuffle', 'validateBookingPlacement'];
// Map / places helpers: no gate found. Out of messaging scope; tracked as a separate finding.
const UNREVIEWED_HELPERS = ['getMapboxToken', 'mapboxGeocode'];
const GATE = /requireAdminActor|resolveSchedulingActor|requireSchedulingActor|user\.role !== 'admin'|me\.role !== 'admin'/;

test('every other backend function has an admin / staff gate', () => {
  const exempt = new Set([...WEBHOOK_SIGNATURE, ...SQUARE_WEBHOOK, ...PUBLIC_BY_DESIGN, ...RETIRED_STUBS, ...UNREVIEWED_HELPERS]);
  const ungated = functions.filter(n => !exempt.has(n) && !GATE.test(read(`base44/functions/${n}/entry.ts`)));
  assert.deepEqual(ungated, []);
});

test('retired stubs do no work', () => {
  for (const n of RETIRED_STUBS) assert.match(read(`base44/functions/${n}/entry.ts`), /performs no scheduling work/, n);
});

test('both Twilio webhooks verify the signature before touching data', () => {
  for (const n of WEBHOOK_SIGNATURE) {
    const src = read(`base44/functions/${n}/entry.ts`);
    assert.match(src, /verifyTwilioSignature/, n);
    assert.ok(src.indexOf('verifyTwilioSignature(') < src.indexOf('createClientFromRequest(req)'), `${n}: verify before any data access`);
    assert.match(src, /status: 401/, n);
  }
});

test('the sender is simulated unless MESSAGING_LIVE is exactly "true"', () => {
  const src = read('base44/functions/processMessageOutbox/sender.ts');
  assert.match(src, /secrets\.get\('MESSAGING_LIVE'\)[^\n]*\.toLowerCase\(\) === 'true'/);
  assert.match(src, /if \(!isLive\(\)\) return simulatedProvider/);
});

test('the sweep checks test data, duplicate rows and opt-out before the provider is reached', () => {
  const src = read('base44/functions/processMessageOutbox/entry.ts');
  const i = (s) => src.indexOf(s);
  assert.ok(i('item.is_test === true') > 0 && i('item.is_test === true') < i('isCanonicalRow(item'));
  assert.ok(i('isCanonicalRow(item') < i('recipientBlock(admin, item)'));
  assert.ok(i('recipientBlock(admin, item)') < i('getProvider(item.channel)'));
});

test('the calendar no longer claims to send an arrival time or writes "waitlist" for it', () => {
  const src = read('src/pages/admin/Schedule.jsx');
  const start = src.indexOf('const handleSendTime');
  const body = src.slice(start, src.indexOf('}, [', start));
  assert.doesNotMatch(body, /BookingRequest\.update/);
  assert.doesNotMatch(body, /marked as sent/);
});

test('Schedule never writes declined / no_show straight to the booking', () => {
  // Status changes go through the server transition, which only accepts these statuses; declined/no_show are not among them.
  assert.match(read('src/pages/admin/Schedule.jsx'), /\['pending', 'confirmed', 'rescheduled'\]\.includes\(s\)/);
  assert.doesNotMatch(read('src/pages/admin/Schedule.jsx'), /BookingRequest\.update\([^)]*status/);
  assert.match(read('src/pages/admin/Schedule.jsx'), /declineBookingRequest\(\{ booking_request_id: appt\.requestId/);
  assert.match(read('src/pages/admin/Schedule.jsx'), /functions\.invoke\('markNoShow'/);
});

test('protected scheduling-core files are present (content is verified by git, not here)', () => {
  for (const f of ['schedulingValidator', 'reshuffleEngine', 'routeFlowOptimiser', 'routeFlowEngine', 'dayRoute', 'appointmentTiming']) {
    assert.ok(read(`base44/shared/${f}.ts`).length > 0, f);
  }
});

test('appointment detail edits go through the server, never a direct booking write', () => {
  // The drawer's one global Edit Booking lives in components/schedule/edit.
  for (const f of ['src/components/schedule/AppointmentDetail.jsx', 'src/components/schedule/edit/BookingEditForm.jsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /BookingRequest\.update/, f);
    assert.match(src, /updateBookingRequest\(/, f);
  }
  // The drawer hosts the editor and must still never write a booking itself.
  assert.doesNotMatch(read('src/components/schedule/AppointmentDetailPanel.jsx'), /BookingRequest\.update/);
});

test('dayRoute re-exports the extracted fingerprint helpers; there is one copy', () => {
  assert.match(read('base44/shared/dayRoute.ts'), /export \{ isBlockRow, isRouteAppointment, routeDayRows, routeFingerprint \}/);
  // routeDayRows is the one rule for the day a route is stamped from AND judged
  // against, so neither copy may be reimplemented here.
  assert.doesNotMatch(read('base44/shared/dayRoute.ts'), /function routeFingerprint|function isRouteAppointment|function isBlockRow|function routeDayRows/);
});