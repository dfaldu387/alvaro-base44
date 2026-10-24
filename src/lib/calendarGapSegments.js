import { decimalToLabel } from '@/lib/timeUtils';
import { snapUpToStep } from '@/lib/appointmentTiming';

const active = (a) => !['cancelled', 'completed', 'no_show'].includes(a.status);
const mins = (hours) => Math.max(0, Math.round(hours * 60));
const key = (from, to) => `db-${from.requestId}_db-${to.requestId}`;

/** Display facts only. Connect still validates every proposed time on the server. */
function waitingReason(to, arrival, blocks, bounds) {
  const duration = (to.bufferEnd || to.apptEnd) - to.apptStart;
  const details = [
    `Earliest arrival after the previous service, its configured buffer and driving: ${decimalToLabel(arrival)}.`,
    `Saved start: ${decimalToLabel(to.apptStart)}. Recorded availability: ${to.availabilityWindow || 'Flexible'}.`,
  ];
  if (to.availability_override) details.push(`Availability override: ${to.override_status.replaceAll('_', ' ')}. The original availability has not been changed.`);
  if (to.schedule_status === 'confirmed') return { fixed: true, label: 'Waiting for confirmed appointment', details: [...details, 'This booking is marked confirmed. Connect keeps confirmed times fixed; it does not clear confirmation flags.'] };
  if (to.schedule_status === 'locked') return { fixed: true, label: 'Waiting for locked appointment', details: [...details, 'This time was locked. Unlock the booking before asking Connect to move it.'] };
  if (to.availability_override && to.override_status !== 'none') return { fixed: true, label: 'Waiting for availability confirmation', details: [...details, 'The active availability override protects this time from Connect. Review it in the appointment details.'] };
  if (bounds && (to.apptStart < bounds.start || to.apptStart + duration > bounds.end + 1e-9)) return { fixed: true, label: 'Outside normal working hours', details: [...details, 'Connect does not automatically move appointments into or out of after-hours time.'] };
  const windowKnown = Number.isFinite(to.windowStart) && Number.isFinite(to.windowEnd);
  if (!windowKnown && to.availabilityWindow && to.availabilityWindow.toLowerCase() !== 'flexible') return { fixed: true, label: 'Availability needs review', details: [...details, 'A usable availability range could not be read, so this gap cannot be called unnecessary.'] };
  const earliest = Math.max(arrival, bounds?.start ?? arrival, windowKnown ? to.windowStart : arrival);
  let candidate = snapUpToStep(earliest);
  let reason = windowKnown && to.windowStart > arrival ? `Client availability starts ${decimalToLabel(to.windowStart)}` : bounds?.start > arrival ? `Working hours start ${decimalToLabel(bounds.start)}` : 'Required scheduling increment';
  for (const block of blocks) {
    if (candidate < block.apptEnd - 1e-9 && candidate + duration > block.apptStart + 1e-9) {
      candidate = snapUpToStep(block.apptEnd);
      reason = `Blocked time until ${decimalToLabel(block.apptEnd)}`;
      details.push(`Blocked time: ${decimalToLabel(block.apptStart)}–${decimalToLabel(block.apptEnd)}.`);
    }
  }
  const latestEnd = Math.min(bounds?.end ?? 24, windowKnown ? to.windowEnd : 24);
  if (candidate + duration > latestEnd + 1e-9) return { fixed: true, label: 'Availability needs review', details: [...details, 'The earlier placement would not finish inside the recorded availability and working hours.'] };
  return { until: candidate, label: reason, details: [...details, `Earliest start with the visible constraints: ${decimalToLabel(candidate)}. Connect revalidates this against the saved schedule.`] };
}

/** Separate buffer, required travel and constrained/avoidable waiting, per barber. */
export function calendarGapSegments(appointments, legs = {}, bounds = null) {
  const result = [];
  // Nothing has been connected yet: the gaps are simply unexplained until Connect
  // measures them, so a draft day is not covered in "not verified" markers.
  const connected = Object.keys(legs || {}).length > 0;
  const groups = new Map();
  for (const a of appointments.filter(active)) {
    const group = `${a.date || ''}|${a.teamMemberId || ''}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(a);
  }
  for (const rows of groups.values()) {
    const ordered = rows.filter(a => !a.isBlock).sort((a, b) => a.apptStart - b.apptStart);
    // Unassigned blocks apply to every barber on the day.
    const blocks = appointments.filter(a => a.isBlock && a.date === ordered[0]?.date && (!a.teamMemberId || a.teamMemberId === ordered[0]?.teamMemberId)).sort((a, b) => a.apptStart - b.apptStart);
    const add = (segment) => {
      let pieces = [{ start: segment.start, end: segment.end }];
      for (const b of blocks) pieces = pieces.flatMap(p => p.end <= b.apptStart || p.start >= b.apptEnd ? [p] : [{ start: p.start, end: Math.min(p.end, b.apptStart) }, { start: Math.max(p.start, b.apptEnd), end: p.end }]);
      for (const p of pieces) if (mins(p.end - p.start) > 0) result.push({ ...segment, ...p, minutes: mins(p.end - p.start), id: `${segment.id}-${p.start}` });
    };
    for (let i = 0; i < ordered.length; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      const end = from.bufferEnd || from.apptEnd;
      if (end > from.apptEnd) add({ id: `buffer-${from.id}`, kind: 'buffer', start: from.apptEnd, end: Math.min(end, to?.apptStart ?? end), label: 'Mandatory service buffer', details: ['Configured on this booking’s service. Driving starts after this buffer, not at the service finish.'] });
      if (!to || to.apptStart <= end + 1e-9) continue;
      const leg = legs?.[key(from, to)];
      if (!leg) { if (connected) add({ id: key(from, to), kind: 'unknown', start: end, end: to.apptStart, label: 'Driving not verified', details: ['This pair has no saved drive time yet. Click Connect Appointments to measure the day.'] }); continue; }
      if (leg.stale || leg.mins == null || leg.state === 'unavailable') {
        add({ id: key(from, to), kind: 'unknown', start: end, end: to.apptStart, label: leg?.stale ? 'Driving needs updating' : 'Driving not verified', details: ['This gap cannot be split into driving and idle time until travel is verified. Click Connect Appointments to calculate the current route.'] });
        continue;
      }
      const arrival = end + Math.max(0, leg.mins) / 60;
      add({ id: `drive-${from.id}-${to.id}`, kind: arrival > to.apptStart + 1e-9 ? 'conflict' : 'drive', start: end, end: Math.min(arrival, to.apptStart), label: arrival > to.apptStart + 1e-9 ? 'Travel conflict' : 'Required driving time', details: [`${leg.mins} min driving. Leave ${decimalToLabel(end)}, arrive ${decimalToLabel(arrival)}.`, ...(arrival > to.apptStart + 1e-9 ? [`The next appointment starts too early at ${decimalToLabel(to.apptStart)}.`] : [])] });
      if (to.apptStart <= arrival + 1e-9) continue;
      const reason = waitingReason(to, arrival, blocks, bounds);
      const waitEnd = reason.fixed ? to.apptStart : Math.min(to.apptStart, reason.until);
      add({ id: `wait-${to.id}`, kind: 'fixed', fixed: reason.fixed, start: arrival, end: waitEnd, label: reason.label, details: reason.details });
      if (!reason.fixed) add({ id: `idle-${to.id}`, kind: 'idle', start: Math.max(arrival, waitEnd), end: to.apptStart, label: 'Unnecessary idle time', details: [...reason.details, 'No visible fixed-time, availability, buffer or blocked-time constraint requires this remaining gap. Click Connect Appointments to bunch the day, then review before confirming.'] });
    }
  }
  return result;
}