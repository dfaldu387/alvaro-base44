import { base44 } from '@/api/base44Client';
import { createAdminBooking } from '@/lib/adminBookingApi';
import { decimalToLabel } from '@/lib/timeUtils';
import { frequencyLabel, occurrenceDates } from '@/lib/appointmentSeries';

/**
 * Blocked time on the Calendar: Lunch, Personal, Unavailable and friends.
 *
 * A block is a real, date-bound schedule record (a BookingRequest row), so editing or
 * removing one changes the schedule itself — removing it hands the time straight back
 * to Route Flow. Nothing here decides anything: the server owns the rules and this
 * only reports its answer.
 */

export const BLOCK_REASONS = [
  'Lunch',
  'Personal',
  'Unavailable',
  'Fuel',
  'Gym',
  'Van Maintenance',
  'Content',
  'Admin Time',
];

/** How a repeating block can repeat. 0 = a one-off block. */
export const BLOCK_REPEAT_OPTIONS = [
  { weeks: 0, label: 'Does not repeat' },
  { weeks: 1, label: 'Weekly' },
  { weeks: 2, label: 'Every 2 weeks' },
  { weeks: 4, label: 'Every 4 weeks' },
];

/** A repeating block writes this many upcoming occurrences — a horizon, not infinity. */
export const BLOCK_SERIES_OCCURRENCES = 8;

/** "12:00pm–1:00pm" */
export function blockTimeLabel(appt) {
  return `${decimalToLabel(appt?.apptStart)}–${decimalToLabel(appt?.apptEnd)}`;
}

/** The block's title: "Lunch", never "[BLOCK] Lunch". */
export function blockReason(appt) {
  const match = String(appt?.clientName || '').match(/^\[BLOCK\]\s*(.*)$/i);
  if (match && match[1]) return match[1];
  const service = Array.isArray(appt?.services) ? appt.services[0] : '';
  return service || 'Blocked time';
}

/** Is this calendar object blocked time rather than a client appointment? */
export function isBlockAppt(appt) {
  return !!appt?.isBlock || appt?.status === 'blocked';
}

/** "Weekly · 8 blocks" for a block that belongs to a repeating series. */
export function blockSeriesLabel(appt) {
  if (!appt?.series_id) return null;
  const count = Number(appt.series_count) || 0;
  return [appt.series_frequency, count ? `${count} block${count === 1 ? '' : 's'}` : null]
    .filter(Boolean).join(' · ');
}

async function invoke(payload) {
  try {
    const res = await base44.functions.invoke('manageBlockTime', payload);
    return res?.data || null;
  } catch (e) {
    const body = e?.response?.data;
    if (body && typeof body === 'object') return { saved: false, ...body };
    return { saved: false, error: e?.message || 'The block could not be saved.' };
  }
}

/** Change a block's title, time, date or notes — for this block or its series. */
export async function updateBlockTime(payload) {
  return invoke({ action: 'update', ...payload });
}

/** Remove a block, freeing its time for scheduling again. */
export async function deleteBlockTime(payload) {
  return invoke({ action: 'delete', ...payload });
}

/** The dates a repeating block covers, starting with its first date. */
export function blockOccurrenceDates(firstDate, everyWeeks) {
  if (!everyWeeks) return [firstDate];
  return occurrenceDates({
    startDate: firstDate,
    everyWeeks,
    ends: 'after',
    count: BLOCK_SERIES_OCCURRENCES,
  });
}

/**
 * Write a block — once, or as a real series so its occurrences can later be edited or
 * removed together. Each occurrence is its own schedule record; the series row is what
 * keeps them recognisable as one repeating block.
 */
export async function createBlocks({ submissionToken, reason, notes, start, end, dates, everyWeeks = 0 }) {
  const rows = [];
  for (let i = 0; i < dates.length; i += 1) {
    // One token per occurrence: a retry of the same save returns that occurrence's
    // existing row instead of creating a duplicate block.
    const row = await createAdminBooking(`${submissionToken}-${i}`, {
      kind: 'block',
      requested_date: dates[i],
      start,
      end,
      reason,
      notes: notes || undefined,
    });
    rows.push(row);
  }

  if (dates.length > 1) {
    await base44.entities.AppointmentSeries.create({
      client_name: `${reason} (blocked time)`,
      scheduling_type: 'exact',
      availability_window: `${decimalToLabel(start)}–${decimalToLabel(end)}`,
      services: [reason],
      duration_mins: Math.round((end - start) * 60),
      frequency_weeks: Math.max(1, everyWeeks),
      frequency_label: frequencyLabel(Math.max(1, everyWeeks)),
      ends: 'after',
      ends_label: `${dates.length} blocks`,
      first_date: dates[0],
      booking_request_ids: rows.map((r) => r.id),
      occurrences_created: rows.length,
      notes: notes || '',
    });
  }

  return rows;
}