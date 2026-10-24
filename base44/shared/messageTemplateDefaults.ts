/**
 * The six messages the business already wrote (the TEMPLATES array that used to
 * live in src/pages/admin/BookingRules.jsx), copied word for word. They are only
 * ever used to create a missing row — an existing template is never overwritten.
 */
export interface DefaultTemplate {
  template_key: string;
  name: string;
  channel: 'sms';
  body: string;
  description: string;
  /** Defaults to true. A draft awaiting approval is created switched OFF, so it can never be sent. */
  is_active?: boolean;
}

/** The arrival-time wording the business started with. A stored template with exactly this text is upgraded to the one below. */
export const ARRIVAL_TIME_BODY_V1 = `Hey {{name}}, your barber is scheduled to arrive at approximately {{time}}. Reply YES to confirm, or NO if you need to cancel or reschedule.`;
/** Same words plus the optional tracking link ({{tracking_link}} is blank-safe). */
export const ARRIVAL_TIME_BODY_V2 = `${ARRIVAL_TIME_BODY_V1} {{tracking_link}}`;
/** Same words, plus where the barber is going ("at {{address}}"), inserted after the time. */
export const ARRIVAL_TIME_BODY = `Hey {{name}}, your barber is scheduled to arrive at approximately {{time}}, at {{address}}. Reply YES to confirm, or NO if you need to cancel or reschedule. {{tracking_link}}`;

/** Request received: the approved words, plus what was booked. */
export const BOOKING_RECEIVED_BODY_V1 = `Hey {{name}}, your Cut Deluxe booking request has been received for {{date}} between {{window}}. We'll confirm once your barber can fit the service within that window.`;
export const BOOKING_RECEIVED_BODY = `Hey {{name}}, your Cut Deluxe booking request for {{service}} has been received for {{date}} between {{window}}. We'll confirm once your barber can fit the service within that window.`;

/** Confirmed: the approved words, plus what, where and the payment position. */
export const BOOKING_CONFIRMED_BODY_V1 = `Hey {{name}}, your Cut Deluxe booking is confirmed for {{date}} between {{window}}. Your exact arrival time will be sent the day before your appointment.`;
export const BOOKING_CONFIRMED_BODY = `Hey {{name}}, your Cut Deluxe booking for {{service}} is confirmed for {{date}} between {{window}}, at {{address}}. {{payment_line}} Your exact arrival time will be sent the day before your appointment.`;

/** Asked when a time is placed outside the availability the customer chose. {{time}} is the offered start, {{date}} the day. */
export const AVAILABILITY_OVERRIDE_CHECK_BODY = `Hey {{name}}, we can fit your appointment at {{time}} on {{date}}. This is outside the availability you originally selected. Reply YES to confirm or NO if that time doesn't work.`;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    template_key: 'booking_received',
    name: 'Request Received',
    channel: 'sms',
    description: 'Sent when a customer submits a booking request.',
    body: BOOKING_RECEIVED_BODY,
  },
  {
    template_key: 'booking_confirmed',
    name: 'Window Confirmed',
    channel: 'sms',
    description: 'Sent when a booking is confirmed for its availability window.',
    body: BOOKING_CONFIRMED_BODY,
  },
  {
    template_key: 'arrival_time',
    name: 'Arrival Time Sent',
    channel: 'sms',
    description: 'Sent the day before, with the barber\'s exact arrival time.',
    body: ARRIVAL_TIME_BODY,
  },
  {
    template_key: 'booking_changed',
    name: 'Booking Changed',
    channel: 'sms',
    description: 'Sent when a confirmed booking is moved to a new date or window.',
    body: `Hey {{name}}, your Cut Deluxe booking has been updated to {{date}} between {{window}}. Your exact arrival time will be sent once finalised.`,
  },
  {
    template_key: 'booking_cancelled',
    name: 'Booking Cancelled',
    channel: 'sms',
    description: 'Sent when a booking is cancelled.',
    body: `Hey {{name}}, your Cut Deluxe booking for {{date}} has been cancelled. Let us know if you would like to request another time.`,
  },
  {
    template_key: 'availability_override_check',
    name: 'Time Outside Availability',
    channel: 'sms',
    description: 'Sent when a time is placed outside the availability the customer chose. {{time}} is the offered start time and {{date}} the day. The customer answers YES or NO.',
    body: AVAILABILITY_OVERRIDE_CHECK_BODY,
  },
  {
    template_key: 'no_show_followup',
    name: 'No-Show Follow Up',
    channel: 'sms',
    description: 'Sent after a no-show.',
    body: `Hey {{name}}, we couldn't complete your appointment today because you weren't available at the arranged time. Future bookings may require a fee or deposit.`,
  },
  // DRAFT wording for the regular-client campaign. Placeholder text written so the
  // flow can be previewed; it is NOT approved copy. Created switched OFF: nothing is
  // sent until Alvaro approves or rewrites the wording and switches it on.
  {
    template_key: 'rebooking_reminder',
    name: 'Rebooking Reminder (DRAFT)',
    channel: 'sms',
    is_active: false,
    description: 'DRAFT, awaiting Alvaro\'s approval. Sent to regular clients who are due for a haircut.',
    body: `DRAFT: Hi {{name}}, you're due for your next cut. Book here: {{booking_link}}`,
  },
  {
    template_key: 'rebooking_followup',
    name: 'Rebooking Follow-up (DRAFT)',
    channel: 'sms',
    is_active: false,
    description: 'DRAFT, awaiting Alvaro\'s approval. One shorter follow-up for clients who have not replied or booked.',
    body: `DRAFT: Hi {{name}}, just checking in. Book here: {{booking_link}}`,
  },
];