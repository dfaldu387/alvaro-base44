import { validateBookingInput } from './publicBookingValidators.ts';
import { readSettingsList } from './settingsStore.ts';
import { resolveIsTest } from './testData.ts';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS } from './groupPricing.ts';
import { buildCatalogue, recalculateBookingItems } from './bookingItems.ts';
import { lookupWebsiteClient } from './websiteClient.ts';
import { loadDepositRules, evaluateForBooking } from './paymentService.ts';

/**
 * The deposit a public booking WOULD be asked for, worked out for the Review step before submitting.
 *
 * Advisory and read-only: it writes nothing (no client, no booking, no payment, no audit row) and the
 * booking creator still makes its own decision when the booking is submitted. It reuses the very same
 * pieces that decision uses: the catalogue maths, the phone-first/email-second client match (read-only
 * form) and paymentService.evaluateForBooking, which runs the pure deposit rules.
 *
 * What it returns is deliberately small: whether a deposit applies and how much, plus ONE fixed line.
 * Never a reason, a no-show count, a client id or whether a client was found. "Not required" is the same
 * answer for a returning customer, a test booking, switched-off rules and input that is not a real
 * booking, so the answer cannot be used to ask why.
 */
export const DEPOSIT_QUOTE_LINE = 'A deposit applies to this booking.';
export const NO_DEPOSIT_QUOTE = { required: false, amount: 0 };

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export async function quoteDeposit(admin: any, body: any): Promise<{ required: boolean; amount: number; line?: string }> {
  // The same field rules as the booking itself: a name and a real mobile number are both needed.
  const { valid, sanitized } = validateBookingInput(body);
  if (!valid) return NO_DEPOSIT_QUOTE;

  // Test classification is the server's, exactly as at submission. A test booking never needs a deposit.
  const isTest = resolveIsTest(body?.manual_test_flag === true, sanitized.client_name);
  if (isTest) return NO_DEPOSIT_QUOTE;

  const [serviceRows, addonRows, settingsRows, rules, link] = await Promise.all([
    admin.entities.Service.list('sort_order', 200),
    admin.entities.AddOn.list('sort_order', 200),
    readSettingsList(admin, 'GroupDiscountSettings'),
    loadDepositRules(admin),
    lookupWebsiteClient(admin, sanitized, isTest),
  ]);

  const settingsRecord = (settingsRows || []).find((s: any) => !s.team_member_id) || (settingsRows || [])[0] || null;
  const items = recalculateBookingItems({
    services: sanitized.services,
    participants: sanitized.participants || [],
    catalogue: buildCatalogue(asList(serviceRows), asList(addonRows)),
    settings: settingsRecord || DEFAULT_GROUP_DISCOUNT_SETTINGS,
    afterHoursMode: sanitized.after_hours_mode,
    afterHoursSlot: sanitized.after_hours_slot,
  });
  if (items.overMax) return NO_DEPOSIT_QUOTE;

  // The same fields createPaymentForBooking reads from the saved booking.
  const decision = await evaluateForBooking(admin, {
    client_id: link?.client_id || null,
    price: Math.round(items.totalPrice * 100) / 100,
    people_count: items.peopleCount,
    after_hours_mode: sanitized.after_hours_mode,
    after_hours_slot: sanitized.after_hours_slot,
    is_test: false,
  }, rules);

  return decision.required && decision.amount > 0
    ? { required: true, amount: decision.amount, line: DEPOSIT_QUOTE_LINE }
    : NO_DEPOSIT_QUOTE;
}