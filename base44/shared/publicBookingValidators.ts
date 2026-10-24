// Shared validation/sanitization helpers for public booking backend functions.

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const VALID_AFTER_HOURS_MODES = ['come_to_me', 'mobile_callout'];
const VALID_TIME_BLOCKS = ['Morning', 'Midday', 'Afternoon', 'Evening'];
const VALID_PRIORITY_STATUS = ['priority', 'outside_priority'];
const VALID_CAPACITY_STATUSES = ['available', 'in_demand', 'limited', 'waitlist', 'closed'];

export function sanitizeString(val, maxLen = 500) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export function validateAuPhone(v) {
  return /^(\+?61\s?)?0?4\d{2}\s?\d{3}\s?\d{3}$/.test(v.trim());
}

export function validateEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function validateBookingInput(input) {
  const errors = [];

  const client_name = sanitizeString(input.client_name, 100);
  if (!client_name || client_name.length < 2) errors.push('Valid name is required.');

  const phone = sanitizeString(input.phone, 30);
  if (!validateAuPhone(phone)) errors.push('Valid Australian mobile number is required.');

  const email = sanitizeString(input.email, 200);
  // Optional: no email is fine, but one that is given must still be a real address so a typo is caught.
  if (email && !validateEmail(email)) errors.push('That email address is not valid.');

  const address = sanitizeString(input.address, 300);
  if (!address || address.length < 5) errors.push('Address is required.');

  const day = sanitizeString(input.day, 20);
  if (!VALID_DAYS.includes(day)) errors.push('Valid day is required.');

  let services = [];
  if (Array.isArray(input.services)) {
    services = input.services.map(s => sanitizeString(s, 100)).filter(Boolean);
  }
  if (services.length === 0) errors.push('At least one service is required.');

  // Explicit participants list: each person carries exactly one primary service
  // and optional add-ons. Multiple primary services for one participant is rejected.
  let participants = [];
  if (Array.isArray(input.participants)) {
    for (const p of input.participants) {
      if (!p || typeof p !== 'object') continue;

      // Reject malformed submissions: a legacy services array with >1 item means
      // someone tried to assign multiple primary services to one person.
      if (Array.isArray(p.services) && p.services.length > 1) {
        errors.push('Each participant may have only one primary service.');
        continue;
      }

      let primary_service = '';
      if (typeof p.primary_service === 'string') {
        primary_service = sanitizeString(p.primary_service, 100);
      } else if (Array.isArray(p.services) && p.services.length === 1) {
        primary_service = sanitizeString(p.services[0], 100);
      }

      let addons = [];
      if (Array.isArray(p.addons)) {
        addons = p.addons.map(a => sanitizeString(a, 100)).filter(Boolean);
      }

      if (primary_service) {
        participants.push({ primary_service, addons });
      }
    }
  }
  if (participants.length === 0) {
    errors.push('At least one participant with a primary service is required.');
  }

  const notes = sanitizeString(input.notes, 500);
  const availability_window = sanitizeString(input.availability_window, 50);
  if (!availability_window) errors.push('Availability window is required.');

  let time_blocks = [];
  if (Array.isArray(input.time_blocks)) {
    time_blocks = input.time_blocks
      .map(t => sanitizeString(t, 20))
      .filter(t => VALID_TIME_BLOCKS.includes(t));
  }

  let time_block = '';
  if (typeof input.time_block === 'string' && VALID_TIME_BLOCKS.includes(input.time_block)) {
    time_block = input.time_block;
  }

  let price = 0;
  if (typeof input.price === 'number' && input.price >= 0 && input.price < 10000) {
    price = Math.round(input.price * 100) / 100;
  }

  let after_hours_mode = null;
  let after_hours_slot = null;
  if (input.after_hours_mode && VALID_AFTER_HOURS_MODES.includes(input.after_hours_mode)) {
    after_hours_mode = input.after_hours_mode;
    after_hours_slot = sanitizeString(input.after_hours_slot, 20);
  }

  // Service Area + priority status (public booking Step 1 — Region).
  // service_area_id is optional (empty for outside-priority bookings).
  // priority_status defaults to 'priority' when an area is selected.
  const service_area_id = sanitizeString(input.service_area_id, 100);
  let priority_status = 'priority';
  if (input.priority_status && VALID_PRIORITY_STATUS.includes(input.priority_status)) {
    priority_status = input.priority_status;
  }

  // Requested date — the actual date selected by the customer (YYYY-MM-DD).
  const requested_date = sanitizeString(input.requested_date, 20);

  // Capacity status at submission time (from backend daySummaries).
  let capacity_status_at_submission = '';
  if (typeof input.capacity_status_at_submission === 'string' && VALID_CAPACITY_STATUSES.includes(input.capacity_status_at_submission)) {
    capacity_status_at_submission = input.capacity_status_at_submission;
  }

  // Structured address data from Mapbox autocomplete. Coordinates are
  // required — an address string alone is not accepted. This ensures
  // every booking has reliable lat/lng for zone matching and routing.
  const address_lat = (typeof input.address_lat === 'number' && isFinite(input.address_lat) && Math.abs(input.address_lat) <= 90) ? input.address_lat : null;
  const address_lng = (typeof input.address_lng === 'number' && isFinite(input.address_lng) && Math.abs(input.address_lng) <= 180) ? input.address_lng : null;
  if (address_lat == null || address_lng == null) {
    errors.push('We couldn\'t verify your service address. Please select it again.');
  }
  const address_postcode = sanitizeString(input.address_postcode, 20);
  const address_suburb = sanitizeString(input.address_suburb, 100);
  const address_state = sanitizeString(input.address_state, 50);
  const address_place_id = sanitizeString(input.address_place_id, 200);

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      client_name,
      phone,
      email,
      address,
      address_lat,
      address_lng,
      address_postcode,
      address_suburb,
      address_state,
      address_place_id,
      day,
      requested_date,
      capacity_status_at_submission,
      services,
      participants,
      notes,
      availability_window,
      time_blocks,
      time_block,
      price,
      after_hours_mode,
      after_hours_slot,
      service_area_id,
      priority_status,
      status: 'pending',
      booking_source: 'Online Booking',
    },
  };
}

export function validateGroupEnquiryInput(input) {
  const errors = [];

  const client_name = sanitizeString(input.client_name, 100);
  if (!client_name || client_name.length < 2) errors.push('Valid name is required.');

  const phone = sanitizeString(input.phone, 30);
  if (!phone || phone.length < 6) errors.push('Valid phone is required.');

  const address = sanitizeString(input.address, 300);
  let num_people = null;
  if (typeof input.num_people === 'number' && input.num_people > 0 && input.num_people < 1000) {
    num_people = Math.floor(input.num_people);
  }
  const preferred_day = VALID_DAYS.includes(input.preferred_day) ? input.preferred_day : null;
  const notes = sanitizeString(input.notes, 500);

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      client_name,
      phone,
      address,
      num_people,
      preferred_day,
      notes,
      status: 'new',
    },
  };
}