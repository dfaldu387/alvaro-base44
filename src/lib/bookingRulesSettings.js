/**
 * Booking Rules settings — the mapping between the page's controls and the
 * BookingRules record, plus validation. minimum_notice_hours and
 * maximum_booking_days are NOT handled here: the Booking Window section owns
 * them and they are never written by this page's save.
 */

export const DEFAULT_SETTINGS = {
  autoAccept: false,
  allowMultipleServices: true,
  maxServicesPerBooking: 6,
  defaultBuffer: 25,
  appointmentInterval: 15,
  cutoffHour: 19,
  minWindowHours: 1,
  maxWindowHours: 4,
  serviceMustFit: true,
  bufferCanExtend: true,
  coreAreas: 'St George, Eastern Suburbs, Inner West',
  outOfAreaAfter3pm: false,
  cancellationPolicy: 'Please give as much notice as possible if you need to cancel or reschedule. Same-day cancellations, late reschedules, or no-shows may require a fee before booking again.',
  allowClientReschedule: true,
  clientNeedsApproval: true,
};

// control key -> [record field, type, validation]
const FIELDS = {
  autoAccept: ['auto_accept_requests', 'boolean'],
  allowMultipleServices: ['allow_multiple_services', 'boolean'],
  maxServicesPerBooking: ['max_services_per_booking', 'int', { min: 1, max: 10, label: 'Max services per booking' }],
  defaultBuffer: ['default_buffer_minutes', 'int', { min: 0, max: 120, label: 'Default buffer time' }],
  appointmentInterval: ['appointment_interval_minutes', 'int', { min: 5, max: 60, label: 'Appointment interval' }],
  cutoffHour: ['booking_cutoff_hour', 'int', { min: 17, max: 22, label: 'Booking cut-off time' }],
  minWindowHours: ['min_availability_window_hours', 'half', { min: 0.5, max: 6, label: 'Minimum availability window' }],
  maxWindowHours: ['max_availability_window_hours', 'half', { min: 1, max: 8, label: 'Maximum availability window' }],
  serviceMustFit: ['service_must_fit_window', 'boolean'],
  bufferCanExtend: ['buffer_can_extend_past_window', 'boolean'],
  coreAreas: ['core_service_areas', 'string', { max: 500, label: 'Core service areas' }],
  outOfAreaAfter3pm: ['out_of_area_after_3pm', 'boolean'],
  cancellationPolicy: ['cancellation_policy', 'string', { max: 2000, label: 'Cancellation policy' }],
  allowClientReschedule: ['allow_client_reschedule', 'boolean'],
  clientNeedsApproval: ['client_reschedule_needs_approval', 'boolean'],
};

/** Saved value when one exists (with the right type), otherwise the default. */
export function fromRecord(record) {
  const out = { ...DEFAULT_SETTINGS };
  if (!record) return out;
  for (const [key, [field, type]] of Object.entries(FIELDS)) {
    const v = record[field];
    if (type === 'boolean' && typeof v === 'boolean') out[key] = v;
    else if (type === 'string' && typeof v === 'string') out[key] = v;
    else if ((type === 'int' || type === 'half') && typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** Field-level problems keyed by control; empty object = valid. Nothing is coerced. */
export function validateSettings(s) {
  const errors = {};
  for (const [key, [, type, rule]] of Object.entries(FIELDS)) {
    const v = s[key];
    if (type === 'boolean') continue;
    if (type === 'string') {
      if (typeof v !== 'string') errors[key] = `${rule.label} must be text.`;
      else if (v.length > rule.max) errors[key] = `${rule.label} must be ${rule.max} characters or fewer.`;
      continue;
    }
    const n = typeof v === 'number' ? v : (String(v).trim() === '' ? NaN : Number(v));
    if (!Number.isFinite(n)) errors[key] = `${rule.label} must be a number.`;
    else if (n < rule.min || n > rule.max) errors[key] = `${rule.label} must be between ${rule.min} and ${rule.max}.`;
    else if (type === 'int' && !Number.isInteger(n)) errors[key] = `${rule.label} must be a whole number.`;
    else if (type === 'half' && !Number.isInteger(n * 2)) errors[key] = `${rule.label} must be in steps of 0.5.`;
  }
  if (!errors.minWindowHours && !errors.maxWindowHours && Number(s.minWindowHours) > Number(s.maxWindowHours)) {
    errors.maxWindowHours = 'Maximum availability window must be at least the minimum.';
  }
  return errors;
}

/** Record payload with correct types. Call only after validateSettings passes. */
export function toPayload(s) {
  const payload = {};
  for (const [key, [field, type]] of Object.entries(FIELDS)) {
    payload[field] = (type === 'int' || type === 'half') ? Number(s[key]) : s[key];
  }
  return payload;
}

/** True when the stored record holds exactly the values that were just written. */
export function recordMatches(record, payload) {
  return !!record && Object.entries(payload).every(([field, v]) => record[field] === v);
}