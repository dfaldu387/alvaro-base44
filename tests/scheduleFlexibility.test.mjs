// Flexible scheduling: wasted-time maths, dragging across days, the removed
// "move confirmed?" modal, undo, and honest client-notification status.
//
// These are source and pure-function checks — no browser, no database, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeIdleMinutes, avoidableGaps } from '../src/lib/idleGaps.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const at = (start, end, id) => ({ id, apptStart: start, apptEnd: end });

test('idle time is the gap left over once the drive has happened', () => {
  const day = [at(10, 10.5, 'a'), at(12, 12.5, 'b')];
  // 90 minutes between them, 30 of which must be driven.
  assert.equal(computeIdleMinutes(day, () => 30), 60);
  // Travel unknown counts as zero, which overstates the waste rather than hiding it.
  assert.equal(computeIdleMinutes(day, () => null), 90);
  // A back-to-back day wastes nothing.
  assert.equal(computeIdleMinutes([at(10, 11, 'a'), at(11, 11.5, 'b')], () => 0), 0);
  assert.equal(computeIdleMinutes([at(10, 11, 'a')], () => 0), 0);
});

test('only gaps longer than the minimum are offered as avoidable', () => {
  const day = [at(10, 11, 'a'), at(11.25, 11.75, 'b'), at(14, 14.5, 'c')];
  const gaps = avoidableGaps(day, () => 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from_id, 'b');
  assert.equal(gaps[0].idle_mins, 135);
});

test('the optimiser weighs idle time as well as driving', () => {
  const src = read('src/lib/autoSortDay.js');
  assert.match(src, /import \{ computeIdleMinutes, avoidableGaps \} from '@\/lib\/idleGaps'/);
  // Cost of a day = driving + idle, so a shorter drive with a huge gap never wins.
  assert.match(src, /const waste = result\.totalDriveMins \+ result\.idleMins/);
  assert.match(src, /currentIdleMins,/);
  assert.match(src, /suggestedIdleMins: computeIdleMinutes\(suggested, driveFor\)/);
});

test('the confirmed-move modal is gone; a confirmed card moves immediately', () => {
  const src = read('src/components/schedule/WeekGrid.jsx');
  assert.doesNotMatch(src, /Move confirmed appointment\?/);
  assert.doesNotMatch(src, /confirmedMovePrompt/);
  // Only a deliberate lock still asks.
  assert.match(src, /a\.schedule_status === 'locked' && protectionSettings\?\.allow_manual_move_locked !== false/);
  // Everything else — confirmed included — is saved straight away, with undo.
  assert.match(src, /onUpdateAppointment\(a\.id, changes, true, prev, opts\)/);
});

test('a card can be dropped on another day, and carries that date with it', () => {
  const src = read('src/components/schedule/WeekGrid.jsx');
  assert.match(src, /const columnAt = \(clientX\) =>/);
  assert.match(src, /dragStateRef\.current\.targetIndex = target\.index/);
  assert.match(src, /\.\.\.\(movedDay \? \{ date: targetDate, day: dayNames\[targetIndex\] \} : \{\}\)/);
  // The drag preview is judged against the column it is headed for.
  assert.match(src, /\[\.\.\.apptsByDay\[target\.index\], \.\.\.blocksByDay\[target\.index\]\]/);
});

test('the calendar saves the dropped date and can undo it', () => {
  const src = read('src/pages/admin/Schedule.jsx');
  assert.match(src, /date: changes\.date \|\| appt\.date/);
  assert.match(src, /const undoMove = showUndo && prevState \? \(\) => handleUpdateAppointment\(/);
  assert.match(src, /\{ apptStart: prevState\.apptStart, date: prevState\.date, day: prevState\.day \}/);
  assert.match(src, /onUndo: undoMove/);
});

test('client notification is reported from what was actually dispatched', () => {
  const page = read('src/pages/admin/Schedule.jsx');
  assert.match(page, /data\.change_message_queued === true/);
  // A confirmed move that could not be texted says so, and claims nothing.
  assert.match(page, /data\.notification_pending === true/);
  assert.match(page, /The client still has the old time — they need the new one\./);

  const line = read('src/components/schedule/ClientNotificationLine.jsx');
  assert.match(line, /template_key: 'booking_changed'/);
  // "Client notified" only for a message the provider accepted.
  assert.match(line, /if \(status === 'sent'\) return \{ kind: 'sent', label: 'Client notified'/);
  assert.match(line, /status === 'failed' \|\| status === 'dead_letter'/);
  assert.match(line, /if \(scheduleStatus !== 'confirmed' \|\| outbox === undefined\) return null;/);
});