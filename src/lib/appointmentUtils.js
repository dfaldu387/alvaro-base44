/**
 * appointmentUtils — maps BookingRequest DB records to calendar appointment objects.
 * Status flow: draft → scheduled → completed / cancelled / no_show / rescheduled
 */
import { parseTimeStr } from './timeUtils.js';
import { normaliseBufferMinutes } from './appointmentTiming.js';

/**
 * Maps a BookingRequest record onto the calendar's appointment object.
 *
 * `bufferMinutes` is the buffer CONFIGURED on that booking's service, resolved
 * from the live catalogue by the caller (bufferMinutesFor). There is no default:
 * a service with no buffer configured shows exactly its service time, so the
 * block a drag has to work around is the real occupancy the backend enforces.
 */
export function reqToAppt(r, bufferMinutes = 0) {
  const start = parseTimeStr(r.assigned_time);
  if (isNaN(start)) return null;
  const durHrs = (r.duration_mins || 30) / 60;
  const isBlock = r.client_name?.startsWith('[BLOCK]') || r.status === 'blocked';
  const bufMins = isBlock ? 0 : normaliseBufferMinutes(bufferMinutes);
  const bufHrs = bufMins / 60;

  let windowStart = null, windowEnd = null;
  if (r.availability_window && r.availability_window !== 'Flexible') {
    const clean = r.availability_window.replace(/\s/g, '').toLowerCase();
    const m = clean.match(/^(.+?)[–\-](.+)$/);
    if (m) { windowStart = parseTimeStr(m[1]); windowEnd = parseTimeStr(m[2]); }
  }

  return {
    id: `db-${r.id}`,
    requestId: r.id,
    day: r.day,
    // Exact calendar date — the calendar's source of truth. A record without a
    // stored date is never shown on the grid (it isn't bound to any day yet).
    date: r.requested_date || null,
    clientName: r.client_name,
    phone: r.phone || '',
    email: r.email || '',
    address: r.address || '',
    address_lat: r.address_lat ?? null,
    address_lng: r.address_lng ?? null,
    services: r.services || [],
    // More than one person: their services are edited in Bookings, never as a flat list.
    isGroup: (Array.isArray(r.participants) && r.participants.length > 1) || r.is_group_booking === true,
    duration: r.duration_mins || 30,
    price: r.price || 0,
    windowStart, windowEnd,
    availabilityWindow: r.availability_window || 'Flexible',
    teamMemberId: r.team_member_id || null,
    apptStart: start,
    apptEnd: start + durHrs,
    bufferEnd: isBlock ? start + durHrs : start + durHrs + bufHrs,
    status: mapDbStatus(r.status),
    availability_override: r.availability_override || false,
    override_status: r.override_status || 'none',
    schedule_status: r.schedule_status || null,
    // The record version this appt was read from — sent back when a manual move
    // is saved so the backend can refuse a write built on stale data.
    updatedDate: r.updated_date || null,
    // Test context is carried onto the calendar so Route Flow activity created
    // during QA stays classified as test data.
    is_test: r.is_test === true,
    notes: r.notes || '',
    defaultBuffer: bufMins,
    extraBuffer: 0,
    payment_status: r.payment_status || 'Unpaid',
    isBlock,
    location: r.address_suburb || r.service_area_name || r.service_zone_name || '',
  };
}

/** Statuses that mean the appointment is on the calendar (not just a pending request) */
export const SCHEDULED_STATUSES = ['confirmed', 'waitlist', 'completed', 'blocked', 'rescheduled', 'no_show', 'declined'];

/** Schedule placement states that mean the appointment is on the calendar */
export const SCHEDULE_PLACED = ['provisional', 'locked', 'confirmed'];

/** Check if a BookingRequest record is placed on the calendar (has a visible slot) */
export function isPlacedOnCalendar(r) {
  return !!(r.assigned_time && (SCHEDULED_STATUSES.includes(r.status) || SCHEDULE_PLACED.includes(r.schedule_status)));
}

/** Map BookingRequest.status → calendar display status */
function mapDbStatus(s) {
  const map = {
    pending: 'draft',
    confirmed: 'scheduled',
    waitlist: 'scheduled',
    completed: 'completed',
    blocked: 'blocked',
    rescheduled: 'rescheduled',
    no_show: 'no_show',
    declined: 'cancelled',
    could_not_fit: 'cancelled',
  };
  return map[s] || 'scheduled';
}

/** Map calendar display status → BookingRequest.status for DB writes */
export function apptStatusToDbStatus(s) {
  const map = {
    draft: 'pending',
    scheduled: 'confirmed',
    completed: 'completed',
    cancelled: 'declined',
    no_show: 'no_show',
    rescheduled: 'rescheduled',
    blocked: 'blocked',
  };
  return map[s] || 'confirmed';
}

/** Check if two time ranges overlap */
export function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

/** Find first overlapping appointment (excluding blocks and cancelled) */
export function findOverlap(appointments, day, start, end, excludeId) {
  return appointments.find(a =>
    a.day === day &&
    a.id !== excludeId &&
    a.status !== 'cancelled' &&
    a.status !== 'no_show' &&
    a.status !== 'completed' &&
    !a.isBlock &&
    overlaps(start, end, a.apptStart, a.apptEnd)
  );
}

/** Find first overlapping block */
export function findBlockOverlap(appointments, day, start, end, excludeId) {
  return appointments.find(a =>
    a.day === day &&
    a.id !== excludeId &&
    a.isBlock &&
    overlaps(start, end, a.apptStart, a.apptEnd)
  );
}