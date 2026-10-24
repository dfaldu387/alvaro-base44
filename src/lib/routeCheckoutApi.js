import { base44 } from '@/api/base44Client';

/**
 * The Execution flow's server calls. Every write on this screen goes through the
 * routeCheckout function: nothing here reprices a booking, records money or completes
 * a stop by itself, and no card payment is ever treated as paid from the browser.
 */
async function call(body) {
  try {
    const res = await base44.functions.invoke('routeCheckout', body);
    return { ok: true, ...res.data };
  } catch (e) {
    const d = e?.response?.data || {};
    return { ok: false, error: d.error || e?.message || 'Could not complete that.' };
  }
}

export const editServices = (bookingRequestId, services) => call({
  action: 'edit_services', booking_request_id: bookingRequestId, services,
});

/** The provider's own checkout page for what is owed at the door. */
export const payCard = (bookingRequestId) => call({ action: 'pay_card', booking_request_id: bookingRequestId });

export const payOffline = (bookingRequestId, method) => call({
  action: 'pay_offline', booking_request_id: bookingRequestId, method,
});

/** Paid: complete the appointment. The expected route version keeps two devices in step. */
export const completeCheckout = (bookingRequestId, expectedUpdatedDate) => call({
  action: 'complete', booking_request_id: bookingRequestId, expected_updated_date: expectedUpdatedDate,
});

export const setReminder = (bookingRequestId, frequency, customDate) => call({
  action: 'set_reminder', booking_request_id: bookingRequestId, frequency, custom_date: customDate,
});

/** The booking's payment record, as the server has it right now. */
export async function loadCheckoutPayment(bookingRequestId) {
  const rows = await base44.entities.BookingPayment.filter({ booking_request_id: bookingRequestId }, { limit: 1 });
  return (Array.isArray(rows) ? rows : rows?.items || [])[0] || null;
}