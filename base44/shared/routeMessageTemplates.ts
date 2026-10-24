import {
  DEFAULT_TEMPLATES,
  ARRIVAL_TIME_BODY_V1, ARRIVAL_TIME_BODY_V2, ARRIVAL_TIME_BODY,
  BOOKING_RECEIVED_BODY_V1, BOOKING_RECEIVED_BODY, BOOKING_CONFIRMED_BODY_V1, BOOKING_CONFIRMED_BODY,
} from './messageTemplateDefaults.ts';

/** A confirmed booking was edited and the customer would notice. {{change}} names what changed. */
export const BOOKING_EDITED_BODY = `Hey {{name}}, your Cut Deluxe booking on {{date}} has changed: your {{change}}. If that doesn't suit, please reply and let us know.`;
/** Night-before reminder when no exact time exists. Commits only to the date, the agreed window and the address. */
export const BOOKING_REMINDER_BODY = `Hey {{name}}, a reminder that your Cut Deluxe {{service}} is tomorrow, {{date}}, {{window_phrase}}, at {{address}}. We'll text you when your barber is on the way. If your plans have changed, please reply and let us know.`;

/**
 * The customer messages the Route tab produces. Created only when missing: an
 * existing template the business edited or switched off is never touched.
 * Wording follows the business's existing "Hey {{name}}," voice.
 *
 * {{eta_window}} (a sentence such as "Arriving between 2:15pm and 2:30pm.") and
 * {{tracking_link}} are optional variables: when there is no ETA or no link they
 * render as nothing and the message reads exactly as it did before.
 */
export const ON_THE_WAY_BODY_V1 = `Hey {{name}}, your Cut Deluxe barber is on the way to you now. See you soon!`;
export const ON_THE_WAY_BODY = `Hey {{name}}, your Cut Deluxe barber is on the way to you now. {{eta_window}} See you soon! {{tracking_link}}`;

/** The deposit wording the business started with: it promised a link that was never sent. A stored template with exactly this text is upgraded. */
export const DEPOSIT_REQUEST_BODY_V1 = 'Hey {{name}}, to lock in your Cut Deluxe booking on {{date}} we need a deposit of ${{amount}}. We will send you a secure payment link shortly.';
export const DEPOSIT_REQUEST_BODY = 'Hey {{name}}, to lock in your Cut Deluxe booking on {{date}} we need a deposit of ${{amount}}. Pay securely here: {{payment_link}} (please pay by {{expires}}).';
export const BALANCE_REQUEST_BODY = 'Hey {{name}}, thanks for having Cut Deluxe today! The balance for your {{service}} is ${{amount}}. Pay securely here: {{payment_link}} (please pay by {{expires}}).';
export const PAYMENT_RECEIPT_BODY = "Hey {{name}}, thanks! We've received your {{purpose}} of ${{amount}} for your Cut Deluxe {{service}}. {{remaining_line}}";

export const ROUTE_TEMPLATES = [
  {
    template_key: 'on_the_way',
    name: 'Barber On The Way',
    channel: 'sms',
    description: 'Sent when the barber presses On my way for a stop. {{eta_window}} is the 15-minute arrival window and {{tracking_link}} the live tracking link; both are left out if unavailable.',
    body: ON_THE_WAY_BODY,
  },
  {
    template_key: 'running_late',
    name: 'Running Late',
    channel: 'sms',
    description: 'Sent once when a stop is running more than 20 minutes late (and once more if it gets past 45). {{time}} is the booked time, {{eta_window}} the new arrival window.',
    body: `Hey {{name}}, sorry, we're running a little behind today. {{eta_window}} Your booking was for {{time}}. Thanks for your patience! {{tracking_link}}`,
  },
  {
    template_key: 'booking_completed',
    name: 'Booking Completed',
    channel: 'sms',
    description: 'Sent when the barber completes a stop. {{payment_line}} says what is paid or owing.',
    body: `Hey {{name}}, thanks for having Cut Deluxe today! Your {{service}} is all done. {{payment_line}}`,
  },
  {
    template_key: 'deposit_request',
    name: 'Deposit Request',
    channel: 'sms',
    description: 'Queued when a booking enters deposit due. {{amount}} is the deposit in dollars, {{payment_link}} the real payment link and {{expires}} when it expires. Keep {{payment_link}} in the wording: a text without it is not sent.',
    body: DEPOSIT_REQUEST_BODY,
  },
  {
    template_key: 'balance_request',
    name: 'Balance Request',
    channel: 'sms',
    description: 'Sent after a cut when money is still owing. {{amount}} is what is owing at the moment of sending, {{payment_link}} the real payment link and {{expires}} when it expires. Keep {{payment_link}} in the wording: a text without it is not sent.',
    body: BALANCE_REQUEST_BODY,
  },
  {
    template_key: 'booking_edited',
    name: 'Booking Edited',
    channel: 'sms',
    description: 'Sent when an admin edits a confirmed booking and the service, price, availability window or address changed. {{change}} names what changed. Not sent for a corrected name, phone, email or note.',
    body: BOOKING_EDITED_BODY,
  },
  {
    template_key: 'booking_reminder',
    name: 'Night-before Reminder',
    channel: 'sms',
    description: 'Sent the evening before to a confirmed booking whose route has not been finalised (a finalised route gets the exact arrival time instead, never both). {{window_phrase}} is "between <their window>" or "sometime during the day". It never states an arrival time.',
    body: BOOKING_REMINDER_BODY,
  },
  {
    template_key: 'payment_receipt',
    name: 'Payment Receipt',
    channel: 'sms',
    description: 'Sent once for each payment received. {{purpose}} is deposit or payment, {{amount}} what was paid and {{remaining_line}} says whether anything is still owing.',
    body: PAYMENT_RECEIPT_BODY,
  },
];

/**
 * A stored template whose body is EXACTLY the old shipped wording is moved to the
 * new wording. Anything the business has edited in any way is left alone.
 */
const UPGRADES = [
  { template_key: 'on_the_way', from: ON_THE_WAY_BODY_V1, to: ON_THE_WAY_BODY },
  { template_key: 'arrival_time', from: ARRIVAL_TIME_BODY_V1, to: ARRIVAL_TIME_BODY },
  { template_key: 'arrival_time', from: ARRIVAL_TIME_BODY_V2, to: ARRIVAL_TIME_BODY },
  { template_key: 'booking_received', from: BOOKING_RECEIVED_BODY_V1, to: BOOKING_RECEIVED_BODY },
  { template_key: 'booking_confirmed', from: BOOKING_CONFIRMED_BODY_V1, to: BOOKING_CONFIRMED_BODY },
  { template_key: 'deposit_request', from: DEPOSIT_REQUEST_BODY_V1, to: DEPOSIT_REQUEST_BODY },
];

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/**
 * Every template the system sends, route and booking alike. The booking defaults
 * come first so the two lists cannot disagree about a shared key.
 *
 * Both lists are seeded here because this is the only seeding path that runs on
 * its own. `seedMessageTemplates` needs an admin to open the template editor; the
 * outbox sweep, booking transitions and route stops all call this function. With
 * only the route templates in it, a fresh install dead-lettered every
 * booking_received and booking_confirmed text ("no message template found") until
 * somebody happened to visit Messages -> Templates.
 */
export const ALL_TEMPLATES = [
  ...DEFAULT_TEMPLATES,
  ...ROUTE_TEMPLATES.filter((r) => !DEFAULT_TEMPLATES.some((d) => d.template_key === r.template_key)),
];

/** Creates whichever templates are missing and upgrades untouched defaults. Returns the keys it created. */
export async function ensureRouteTemplates(admin: any): Promise<string[]> {
  const existing = asList(await admin.entities.MessageTemplate.list('created_date', 200));
  const have = new Set(existing.map((t: any) => t.template_key));
  const missing = ALL_TEMPLATES.filter((t) => !have.has(t.template_key));
  // is_active is read from the template, not forced on: the two rebooking drafts
  // are created switched OFF so nothing is sent before Alvaro approves the words.
  if (missing.length > 0) await admin.entities.MessageTemplate.bulkCreate(missing.map((t: any) => ({ ...t, is_active: t.is_active ?? true })));

  for (const up of UPGRADES) {
    const row = existing.find((t: any) => t.template_key === up.template_key);
    if (row && String(row.body || '').trim() === up.from.trim()) {
      await admin.entities.MessageTemplate.update(row.id, { body: up.to });
    }
  }
  return missing.map((t) => t.template_key);
}