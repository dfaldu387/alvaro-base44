// Sample values the editor preview fills in (same ones the old template list used).
export const SAMPLE_VALUES = {
  name: 'James', date: 'Friday 11 Jul', window: '2:00pm–4:00pm', time: '2:30pm', booking_link: 'https://cutdeluxe.com.au/book',
  eta_window: 'Arriving between 2:15pm and 2:30pm.', tracking_link: 'Track your barber live: https://cutdeluxe.com.au/status/AbC123xyz',
  service: 'Skin Fade', address: '12 Smith St, Bondi NSW 2026', payment_line: '$45.00 due after your service.',
  change: 'service is now Skin Fade and price is now $45.00', window_phrase: 'between 2:00pm–4:00pm',
  last_visit: 'Friday 12 June', frequency: 'about every 4 weeks',
  amount: '25.00', payment_link: 'https://square.link/u/AbC123', expires: 'Saturday 18 July, 5:30pm', purpose: 'deposit',
  remaining_line: 'The remaining $55.00 is due after your service.',
};

// The keys the system expects, in display order. Wording lives in the database.
export const EXPECTED_TEMPLATE_KEYS = [
  'booking_received',
  'booking_confirmed',
  'arrival_time',
  'booking_changed',
  'booking_cancelled',
  'no_show_followup',
  'rebooking_reminder',
  'rebooking_followup',
  'on_the_way',
  'running_late',
  'booking_completed',
  'booking_edited',
  'booking_reminder',
  'deposit_request',
  'balance_request',
  'payment_receipt',
];

const V = {
  name: { key: 'name', label: "Customer's first name" },
  date: { key: 'date', label: 'Booking date' },
  window: { key: 'window', label: 'Availability window', canBeBlank: true },
  time: { key: 'time', label: 'Scheduled arrival time' },
  service: { key: 'service', label: 'Services booked', canBeBlank: true },
  address: { key: 'address', label: 'Service address', canBeBlank: true },
  booking_link: { key: 'booking_link', label: 'Booking link' },
  eta_window: { key: 'eta_window', label: 'Arrival window sentence ("Arriving between 2:15pm and 2:30pm.")', canBeBlank: true },
  tracking_link: { key: 'tracking_link', label: 'Live tracking link sentence', canBeBlank: true },
  payment_line: { key: 'payment_line', label: 'Payment position, e.g. "$45.00 due after your service."' },
  change: { key: 'change', label: 'What changed, e.g. "service is now Skin Fade and price is now $45.00"' },
  window_phrase: { key: 'window_phrase', label: '"between <their window>" or "sometime during the day"' },
  last_visit: { key: 'last_visit', label: "Date of the client's last visit (only when known)" },
  frequency: { key: 'frequency', label: 'How often they usually come, e.g. "about every 4 weeks" (only when known)' },
  amount: { key: 'amount', label: 'Amount in dollars, e.g. 25.00' },
  payment_link: { key: 'payment_link', label: 'The real payment link' },
  expires: { key: 'expires', label: 'When the payment link expires' },
  purpose: { key: 'purpose', label: 'What was paid: deposit or payment' },
  remaining_line: { key: 'remaining_line', label: 'Whether anything is still owing' },
};

// Variables each message is actually given by the code that queues it (booking
// messages, lifecycle messages, arrival times, campaign). `required` = the
// wording is meaningless without it. `canBeBlank` = real data may leave it empty,
// in which case the renderer refuses to send rather than send a gap.
export const TEMPLATE_META = {
  booking_received: { trigger: 'A customer submits a booking request.', variables: [V.name, V.date, V.window, V.service], required: ['date'] },
  booking_confirmed: { trigger: 'An admin confirms a booking.', variables: [V.name, V.date, V.window, V.service, V.address, V.payment_line], required: ['date'] },
  arrival_time: { trigger: 'The evening before, once the day\'s route is finalised.', variables: [V.name, V.time, V.address, V.tracking_link], required: ['time'] },
  booking_edited: { trigger: 'An admin edits a confirmed booking and the service, price, window or address changed.', variables: [V.name, V.date, V.change], required: ['change'] },
  booking_reminder: { trigger: 'The evening before, for a confirmed booking whose route is not finalised (never sent together with the arrival time).', variables: [V.name, V.date, V.service, V.window_phrase, V.address], required: ['date'] },
  deposit_request: { trigger: 'A booking needs a deposit. Sent with the real payment link.', variables: [V.name, V.date, V.amount, V.payment_link, V.expires], required: ['amount', 'payment_link'] },
  balance_request: { trigger: 'The barber completes a stop and money is still owing. Checked again just before sending.', variables: [V.name, V.service, V.amount, V.payment_link, V.expires], required: ['amount', 'payment_link'] },
  payment_receipt: { trigger: 'A payment is received (Square, an admin, or cash). One per payment.', variables: [V.name, V.purpose, V.amount, V.service, V.remaining_line], required: ['amount'] },
  booking_changed: { trigger: 'A confirmed booking is moved to a new date or window.', variables: [V.name, V.date, V.window], required: ['date'] },
  booking_cancelled: { trigger: 'A booking is cancelled or declined by an admin.', variables: [V.name, V.date], required: ['date'] },
  no_show_followup: { trigger: 'A booking is marked as a no-show.', variables: [V.name], required: [] },
  rebooking_reminder: { trigger: 'Regular-client reminder campaign: the reminder run.', variables: [V.name, V.booking_link, V.last_visit, V.frequency], required: ['booking_link'] },
  rebooking_followup: { trigger: 'Regular-client reminder campaign: the follow-up run.', variables: [V.name, V.booking_link, V.last_visit, V.frequency], required: ['booking_link'] },
  on_the_way: { trigger: 'The barber presses On my way on the Route tab.', variables: [V.name, V.eta_window, V.tracking_link], required: [] },
  running_late: { trigger: 'A stop is running more than 20 minutes behind its booked time (sent once, and once more past 45 minutes).', variables: [V.name, V.time, V.eta_window, V.tracking_link], required: ['time'] },
  booking_completed: { trigger: 'The barber completes a stop on the Route tab.', variables: [V.name, V.service, { key: 'payment_line', label: 'Paid or amount owing' }], required: ['service', 'payment_line'] },
};

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Placeholder names used in a body, and whether stray braces remain. */
export function scanPlaceholders(body) {
  const text = String(body || '');
  const used = [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
  const malformed = /\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''));
  return { used, malformed };
}

/** Checks a body against the selected template's own variable list. */
export function validateBody(key, body) {
  const meta = TEMPLATE_META[key];
  const { used, malformed } = scanPlaceholders(body);
  if (!meta) return { known: false, unknown: [], missingRequired: [], malformed, used };
  const supported = meta.variables.map((v) => v.key);
  return {
    known: true,
    used,
    malformed,
    unknown: used.filter((u) => !supported.includes(u)),
    missingRequired: meta.required.filter((r) => !used.includes(r)),
  };
}