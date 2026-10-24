import { decimalToLabel } from '@/lib/timeUtils';
import { latestValidStart } from '@/lib/availabilityWindow';

/**
 * The drop preview: what the calendar shows WHILE a request is being dragged.
 *
 * It is a fast, local reading of the hard rules so the barber gets instant
 * feedback — never the decision. Nothing is saved from here: every drop is sent to
 * the backend, which re-validates against the shared engine and is the only thing
 * that decides. A preview that says "valid" can still be refused on drop (the day
 * may have moved), and the refusal is what is explained to the barber.
 *
 *   valid    — inside the customer's window, no conflict
 *   override — otherwise schedulable, but outside their window (soft: an
 *              administrator may override it, and the customer is asked)
 *   invalid  — a hard rule is broken (never offerable)
 */
export const PLACEMENT_STATES = { valid: 'valid', override: 'override', invalid: 'invalid' };

export function previewPlacement({
  startDecimal, durationMins, bufferMins = 0, window: win,
  dayAppts = [], dayBlocks = [], bounds = null, closed = false,
}) {
  const dur = (Number(durationMins) || 30) / 60;
  const buf = (Number(bufferMins) || 0) / 60;
  const start = Number(startDecimal);
  const occupiedEnd = start + dur + buf;

  if (closed) return { state: 'invalid', reason: 'This day is closed.' };

  if (bounds) {
    if (start < bounds.start - 1e-6) {
      return { state: 'invalid', reason: `Outside working hours. The day starts at ${decimalToLabel(bounds.start)}.` };
    }
    if (start + dur > bounds.end + 1e-6) {
      return { state: 'invalid', reason: `Outside working hours. The last appointment must finish by ${decimalToLabel(bounds.end)}.` };
    }
  }

  for (const block of dayBlocks) {
    if (start < block.apptEnd - 1e-6 && occupiedEnd > block.apptStart + 1e-6) {
      return { state: 'invalid', reason: `Overlaps blocked time (${decimalToLabel(block.apptStart)}–${decimalToLabel(block.apptEnd)}).` };
    }
  }

  for (const appt of dayAppts) {
    if (appt.status === 'cancelled') continue;
    const theirEnd = appt.bufferEnd || appt.apptEnd;
    if (start < theirEnd - 1e-6 && occupiedEnd > appt.apptStart + 1e-6) {
      const protectedAppt = appt.schedule_status === 'locked' || appt.schedule_status === 'confirmed';
      const who = appt.clientName ? `${appt.clientName} ` : '';
      const when = `${decimalToLabel(appt.apptStart)}–${decimalToLabel(appt.apptEnd)}`;
      return {
        state: 'invalid',
        reason: protectedAppt
          ? `Overlaps protected appointment: ${who}${when}.`
          : `Overlaps existing appointment: ${who}${when}.`,
      };
    }
  }

  if (win && (start < win.start - 1e-6 || start + dur > win.end + 1e-6)) {
    const latest = latestValidStart(win, durationMins);
    // A preference, not a boundary: the drop is allowed, and the client is asked
    // to confirm the new time.
    return {
      state: 'override',
      reason: `Outside preferred availability (${decimalToLabel(win.start)}–${decimalToLabel(win.end)}) — the client will be asked to confirm. The latest start that fits is ${decimalToLabel(latest)}.`,
    };
  }

  return { state: 'valid', reason: 'Inside preferred availability — no conflicts.' };
}

/** Short label for the drag chip. */
export const STATE_LABEL = {
  valid: 'Valid',
  override: 'Outside preference — SMS sent',
  invalid: 'Cannot place here',
};