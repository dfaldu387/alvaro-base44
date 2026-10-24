import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor, actorOwnsBooking } from '../../shared/schedulingAuth.ts';
import { getPaymentProvider } from '../../shared/paymentProvider.ts';
import { paymentOrLegacy } from '../../shared/ensurePayment.ts';
import { recordOfflinePayment } from '../../shared/offlinePayment.ts';
import { issuePaymentLink } from '../../shared/paymentLink.ts';
import { finishCompletion } from '../../shared/routeCompletion.ts';
import { owedAfterService } from '../../shared/paymentMessages.ts';
import { asList, findRunnableRoute, planStopStep, writeStopStep } from '../../shared/routeStopStep.ts';
import { buildCatalogue, recalculateBookingItems, planFlatServiceEdit } from '../../shared/bookingItems.ts';
import { readSettingsList } from '../../shared/settingsStore.ts';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS } from '../../shared/groupPricing.ts';
import { addDaysYmd } from '../../shared/cadence.ts';
import { normaliseAuPhone } from '../../shared/auPhone.ts';
import { takePaymentLinkSlot, tooMany } from '../../shared/paymentRateLimit.ts';

/**
 * routeCheckout — the one server path behind the Route tab's Execution flow
 * (client list → Checkout → Next Haircut).
 *
 *   edit_services { services, addon_names }   reprice the booking from the live catalogue, before payment
 *   pay_card      {}                           make or reuse the provider's payment link for what is owed at the door
 *   pay_offline   { method }                   record money taken in person (Cash / Transfer / Card)
 *   complete      { expected_updated_date }    the appointment is paid, so complete it and stamp the client's visit
 *   set_reminder  { frequency, custom_date }   put the client back into the rebooking workflow
 *
 * Gated exactly like the rest of the route: an admin, or the barber the booking belongs to.
 *
 * It owns no money rules, no pricing and no completion rules of its own: it reuses
 * bookingItems (catalogue pricing), the payment engine (offlinePayment / paymentLink),
 * the stop state machine and routeCompletion. Completion is a single Checkout tap, so
 * the steps the state machine still requires between planned and completed (arrive,
 * start) are recorded here rather than asked of the barber as separate buttons.
 */

const DEAD = ['declined', 'cancelled', 'no_show', 'could_not_fit', 'blocked'];
const SETTLED = ['paid_in_full', 'refund_pending', 'partially_refunded', 'refunded'];
const REMINDER_DAYS: Record<string, number> = { Weekly: 7, Fortnightly: 14, 'Every 3 weeks': 21, Monthly: 30 };
const ymd = (v: unknown) => String(v || '').slice(0, 10);
const cents = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * At the door, an unpaid deposit is no longer a separate ask: the service has been
 * delivered, so the whole unpaid amount is owed. Bringing the state to balance_due
 * is what lets the one payment engine collect the lot.
 */
async function promoteUnpaidDeposit(admin: any, booking: any, payment: any) {
  if (!payment || payment.state !== 'deposit_due') return payment;
  await admin.entities.BookingPayment.updateMany(
    { id: payment.id, state: 'deposit_due' },
    { $set: { state: 'balance_due' } },
  );
  const after = await admin.entities.BookingPayment.get(payment.id).catch(() => null);
  if (!after || after.state !== 'balance_due') return after || payment;
  await admin.entities.PaymentEvent.create({
    booking_request_id: booking.id, event_type: 'evaluated', from_state: 'deposit_due', to_state: 'balance_due',
    actor: 'Route', note: 'The service has been delivered, so the unpaid deposit is no longer asked for separately: the whole amount is now owing.',
    is_test: booking.is_test === true,
  });
  return after;
}

export default async function (req: Request) {
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    Response.json({ ok: false, error, ...extra }, { status });
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const id = String(body?.booking_request_id || '').trim();
    const action = String(body?.action || '');
    if (!id) return fail(400, 'booking_request_id required');
    if (!['edit_services', 'pay_card', 'pay_offline', 'complete', 'set_reminder'].includes(action)) {
      return fail(400, 'Unknown action.');
    }

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return fail(404, 'Booking not found.');
    if (!actorOwnsBooking(actor, booking)) return fail(403, 'You can only check out appointments assigned to you.');
    if (DEAD.includes(String(booking.status))) {
      return fail(409, `A ${String(booking.status).replace(/_/g, ' ')} booking cannot be checked out.`);
    }

    let payment = await paymentOrLegacy(admin, booking, actor.name);

    // ── Reprice before payment ───────────────────────────────────────────────
    if (action === 'edit_services') {
      if (SETTLED.includes(String(payment.state))) return fail(409, 'This appointment is already paid, so its services cannot be changed here.');
      const [serviceRows, addonRows, settingsRows] = await Promise.all([
        admin.entities.Service.list('sort_order', 200).catch(() => []),
        admin.entities.AddOn.list('sort_order', 200).catch(() => []),
        readSettingsList(admin, 'GroupDiscountSettings').catch(() => []),
      ]);
      const activeAddons = asList(addonRows).filter((a: any) => a?.is_active !== false).map((a: any) => a.name);
      const plan = planFlatServiceEdit({
        currentParticipants: booking.participants,
        services: Array.isArray(body?.services) ? body.services : [],
        addonNames: activeAddons,
      });
      if (!plan.ok) return fail(400, plan.error);

      const settings = asList(settingsRows).find((s: any) => !s.team_member_id)
        || asList(settingsRows)[0] || DEFAULT_GROUP_DISCOUNT_SETTINGS;
      const items = recalculateBookingItems({
        services: plan.participants.flatMap((p: any) => [p.primary_service, ...(p.addons || [])]).filter(Boolean),
        participants: plan.participants,
        catalogue: buildCatalogue(asList(serviceRows), asList(addonRows)),
        settings,
        afterHoursMode: booking.after_hours_mode,
        afterHoursSlot: booking.after_hours_slot,
      });
      if (items.names.length === 0) return fail(400, 'A booking needs at least one service.');
      if (!(items.durationMins > 0)) return fail(400, 'Those services have no usable duration — check the service catalogue.');

      const subtotal = cents(items.subtotal);
      const total = cents(items.totalPrice);
      const updated = await admin.entities.BookingRequest.update(booking.id, {
        services: items.names, participants: items.participants,
        duration_mins: items.durationMins, subtotal, price: total,
        people_count: items.peopleCount, is_group_booking: items.isGroupBooking,
        group_discount: items.groupDiscount,
        group_discount_type: items.tier ? items.tier.type : null,
        group_discount_tier: items.tier ? items.tier.tier : null,
      });

      // The payment record is what collects the money, so its total follows the new price.
      const paid = Number(payment.amount_paid) || 0;
      const deposit = Number(payment.deposit_amount) || 0;
      const state = paid <= 0 ? payment.state
        : paid >= total - 0.001 ? 'paid_in_full'
        : deposit > 0 && paid >= deposit - 0.001 ? 'deposit_paid'
        : deposit > 0 ? 'deposit_due' : 'balance_due';
      const savedPayment = await admin.entities.BookingPayment.update(payment.id, {
        total_amount: total, state, updated_by: actor.name,
      }).catch(() => null);
      payment = savedPayment || { ...payment, total_amount: total, state };

      try {
        await admin.entities.ActivityLog.create({
          action: 'route_checkout_service_edited',
          actor: 'barber',
          summary: `Checkout: services changed to ${items.names.join(', ')}`,
          detail: [`total now $${total.toFixed(2)}`, `by ${actor.name}`].join(' · ').slice(0, 400),
          related_record_id: booking.id,
          related_record_type: 'BookingRequest',
          client_id: booking.client_id || undefined,
          schedule_date: booking.requested_date,
          previous_value: `$${cents(booking.price).toFixed(2)}`,
          new_value: `$${total.toFixed(2)}`,
          timestamp: new Date().toISOString(),
        });
      } catch { /* an audit failure must never undo the edit */ }

      return Response.json({
        ok: true, services: items.names, participants: items.participants,
        subtotal, total, duration_mins: items.durationMins,
        group_discount: items.groupDiscount, updated_date: updated?.updated_date || null,
      });
    }

    // ── Take the money ──────────────────────────────────────────────────────
    if (action === 'pay_card' || action === 'pay_offline') {
      payment = await promoteUnpaidDeposit(admin, booking, payment);

      if (action === 'pay_card') {
        const slot = await takePaymentLinkSlot(admin, booking.id);
        if (!slot.allowed) return tooMany(slot.retryAfterSeconds, 'Too many payment link requests for this appointment. Wait a moment and try again.');
        const link = await issuePaymentLink(admin, {
          paymentId: payment.id, provider: getPaymentProvider(), actor: actor.name, automation: false,
        });
        if (!link.ok) return fail(link.retryable ? 502 : 409, link.reason);
        return Response.json({ ok: true, url: link.url, expires_at: link.expiresAt, amount: link.amount, reused: link.reused });
      }

      const method = ['Cash', 'Transfer', 'Card'].includes(String(body?.method)) ? String(body.method) : 'Cash';
      const done = await recordOfflinePayment(admin, { booking, payment, method, actor: actor.name });
      if (!done.ok) return fail(done.status, done.error);
      return Response.json({ ok: true, payment: done.payment, method });
    }

    // ── The appointment is paid: complete it ────────────────────────────────
    // The day's route is the record of the run, so the stop is moved to completed
    // exactly as the route's own step does: same state machine, same stored place.
    if (action === 'complete') {
      // Payment comes first, enforced here and not only on the screen: an appointment with money
      // still owing cannot be completed. A card payment counts only once the provider has confirmed
      // it (amount_paid is written by the verified webhook), never when the link is merely created.
      const owingNow = owedAfterService(payment);
      if (owingNow > 0 && payment.state !== 'written_off') {
        return fail(402, `Payment is required before completing: $${owingNow.toFixed(2)} is still owing.`, { outstanding: owingNow, payment_state: payment.state });
      }
      const now = new Date().toISOString();
      const found = await findRunnableRoute(admin, booking, id, body?.expected_updated_date);
      if (!found.ok) return fail(found.status, found.message, found.extra || {});
      const record = found.record;

      // One Checkout tap arrives, does the cut and finishes: walk the steps the state
      // machine requires, so nothing is ever recorded out of order.
      const plan = planStopStep(record, id, ['arrive', 'start', 'complete']);
      if (!plan.ok) return fail(plan.status, plan.message);

      let updatedDate = record.updated_date;
      if (!plan.already) {
        const written = await writeStopStep(admin, {
          record, booking, bookingId: id, prev: plan.prev, state: plan.state, action: 'complete', actor: actor.name,
          summary: `Route stop completed at checkout · ${booking.requested_date}`,
          detail: `by ${actor.name} · paid at the door`,
        });
        updatedDate = written.updatedDate;
      }

      // Completing stamps the visit, closes the open follow-up, texts the customer and
      // asks for money only if any is still owed (see routeCompletion).
      const done = await finishCompletion(admin, booking, now);
      const owing = owedAfterService(payment);
      return Response.json({
        ok: true, already_completed: plan.already, updated_date: updatedDate,
        message_queued: done.message_queued, client_stamped: done.client_stamped,
        outstanding: owing,
      });
    }

    // ── Next Haircut: back into the rebooking workflow ──────────────────────
    const label = String(body?.frequency || '');
    const visit = ymd(booking.requested_date) || ymd(new Date().toISOString());
    let days = REMINDER_DAYS[label] || 0;
    let customDays: number | null = null;
    if (label === 'Custom') {
      const target = ymd(body?.custom_date);
      const gap = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${visit}T00:00:00Z`)) / 86400000);
      if (!target || !Number.isFinite(gap) || gap < 1) return fail(400, 'Choose a date after this appointment.');
      customDays = gap;
      days = gap;
    }
    if (!days) return fail(400, 'Choose how often this client gets a cut.');
    const next = addDaysYmd(visit, days);

    const phone = normaliseAuPhone(booking.phone) || String(booking.phone || '').trim();
    let client: any = null;
    if (booking.client_id) {
      try { client = await admin.entities.ReminderClient.get(booking.client_id); } catch { client = null; }
    }
    if (!client && phone) {
      const byPhone = asList(await admin.entities.ReminderClient.filter(
        { $or: [{ phone_normalised: phone }, { phone }] }, '-created_date', 2,
      ).catch(() => []));
      client = byPhone.length === 1 ? byPhone[0] : null;
    }
    if (!client && booking.client_name) {
      const byName = asList(await admin.entities.ReminderClient.filter({ client_name: booking.client_name }, '-created_date', 2).catch(() => []));
      client = byName.length === 1 ? byName[0] : null;
    }

    // A person has just chosen this rhythm, so it is the one that is used (see shared/cadence).
    const patch: Record<string, any> = {
      frequency: label, cadence_source: 'manual', cadence_computed_at: new Date().toISOString(),
      next_reminder_date: next, workflow_stage: 'none', is_paused: false,
      ...(customDays != null ? { custom_frequency_days: customDays } : {}),
    };
    let created = false;
    if (client) {
      await admin.entities.ReminderClient.update(client.id, patch);
    } else {
      client = await admin.entities.ReminderClient.create({
        client_name: booking.client_name, phone: booking.phone || '', email: booking.email || '',
        address: booking.address || '', suburb: booking.address_suburb || '', postcode: booking.address_postcode || '',
        source: 'Existing booking', client_type: 'Regular', last_visit_date: visit,
        is_test: booking.is_test === true, ...patch,
      });
      created = true;
    }

    try {
      await admin.entities.ActivityLog.create({
        action: 'route_checkout_reminder_set',
        actor: 'barber',
        summary: `Next cut booked in for ${label.toLowerCase()} · ${next}`,
        detail: [`by ${actor.name}`, created ? 'client record created' : 'existing client updated'].join(' · ').slice(0, 400),
        related_record_id: booking.id,
        related_record_type: 'BookingRequest',
        client_id: client?.id || booking.client_id || undefined,
        schedule_date: booking.requested_date,
        new_value: label,
        timestamp: new Date().toISOString(),
      });
    } catch { /* an audit failure must never undo the reminder */ }

    return Response.json({
      ok: true, frequency: label, custom_frequency_days: customDays,
      next_reminder_date: next, client_id: client?.id || null, client_created: created,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}