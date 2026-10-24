import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { readSettingsList } from '../../shared/settingsStore.ts';
import { parseWindow } from '../../shared/provisionalPlacement.ts';
import { buildCatalogue, recalculateBookingItems, planFlatServiceEdit } from '../../shared/bookingItems.ts';
import { resolveBookingLocation } from '../../shared/bookingLocation.ts';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS } from '../../shared/groupPricing.ts';
import { processBookingRequest } from '../../shared/routeFlowEngine.ts';
import { placementPatch } from '../../shared/placementReason.ts';
import { enqueueBookingEdited } from '../../shared/bookingLifecycle.ts';

/**
 * Edit a booking request — the admin's way out of a request Route Flow could
 * not place.
 *
 * Admin-only. Contact details, the availability window, the service and add-ons,
 * the service address and the notes can all be corrected; everything that
 * follows from them (duration, price, group size and discount, coverage tier,
 * matched zone) is recalculated server-side from the catalogue and the saved
 * coverage configuration, exactly as a submitted booking is.
 *
 * Editing never hides a request. The record is pushed back to Processing with no
 * placement outcome recorded, and then Route Flow re-runs immediately on the
 * server — so the admin never presses anything to retry it. The result is
 * written the same way every other placement attempt is: a provisional slot, or
 * Unscheduled / Needs Review with the updated reason.
 *
 * A provisional slot is released for re-evaluation; a locked or confirmed time
 * is protected and is never touched by an edit.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const admin = base44.asServiceRole;

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const bookingId = String(body.booking_request_id || '').trim();
    if (!bookingId) return Response.json({ error: 'booking_request_id required' }, { status: 400 });

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(bookingId); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'booking request not found' }, { status: 404 });
    if (['declined', 'cancelled', 'completed', 'no_show'].includes(booking.status)) {
      return Response.json({
        error: 'This request is already resolved. Reopen it before editing.',
      }, { status: 400 });
    }

    const patch: Record<string, any> = {};
    const changed: string[] = [];
    const noteChange = (label: string, before: unknown, after: unknown) => {
      if (String(before ?? '') !== String(after ?? '')) changed.push(label);
    };

    // ── Contact details ──────────────────────────────────────────────────────
    if (body.client_name !== undefined) {
      const name = String(body.client_name || '').trim();
      if (name.length < 2) return Response.json({ error: 'Please enter the client’s full name.' }, { status: 400 });
      noteChange('Name', booking.client_name, name);
      patch.client_name = name;
    }
    if (body.phone !== undefined) {
      const phone = String(body.phone || '').trim();
      if (phone.replace(/\D/g, '').length < 8) {
        return Response.json({ error: 'Please enter a valid phone number.' }, { status: 400 });
      }
      noteChange('Phone', booking.phone, phone);
      patch.phone = phone;
    }
    if (body.email !== undefined) {
      const email = String(body.email || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
      }
      noteChange('Email', booking.email, email);
      patch.email = email;
    }
    if (body.notes !== undefined) {
      const notes = String(body.notes || '').slice(0, 2000);
      noteChange('Notes', booking.notes, notes);
      patch.notes = notes;
    }

    // ── Availability window ──────────────────────────────────────────────────
    // The customer's window is what Route Flow places inside, so it must be
    // readable. An after-hours booking keeps the slot the customer agreed to.
    if (body.availability_window !== undefined) {
      const isAfterHours = !!(booking.after_hours_mode && booking.after_hours_slot);
      if (isAfterHours) {
        return Response.json({
          error: 'This is an after-hours booking — its window is the slot the customer agreed to.',
        }, { status: 400 });
      }
      const raw = String(body.availability_window || '').trim();
      const flexible = raw.toLowerCase() === 'flexible';
      if (!raw) {
        return Response.json({
          error: 'An availability window is required — for example 9am–2pm, or type Flexible.',
        }, { status: 400 });
      }
      if (!flexible && !parseWindow(raw)) {
        return Response.json({
          error: `We couldn't read "${raw}". Try a format like 9am–2pm, 2pm–7pm, or Flexible.`,
        }, { status: 400 });
      }
      noteChange('Availability window', booking.availability_window, raw);
      patch.availability_window = raw;
    }

    // ── Service address (coordinates come from the address picker) ───────────
    // Only sent when the admin actually picked an address, so an untouched
    // address is never re-geocoded or cleared.
    if (body.address !== undefined) {
      const address = String(body.address || '').trim();
      const lat = Number(body.address_lat);
      const lng = Number(body.address_lng);
      if (!address || !isFinite(lat) || !isFinite(lng)) {
        return Response.json({
          error: 'Please pick the address from the suggestions so we can verify it.',
        }, { status: 400 });
      }
      noteChange('Service address', booking.address, address);
      patch.address = address;
      patch.address_lat = lat;
      patch.address_lng = lng;
      patch.address_postcode = String(body.address_postcode || '');
      patch.address_suburb = String(body.address_suburb || '');
      patch.address_state = String(body.address_state || '');
      patch.address_place_id = String(body.address_place_id || '');
    }

    // ── Services and add-ons, then everything that follows from them ─────────
    const [serviceRows, addonRows, settingsRows, zoneRows] = await Promise.all([
      admin.entities.Service.list('sort_order', 200).catch(() => []),
      admin.entities.AddOn.list('sort_order', 200).catch(() => []),
      readSettingsList(admin, 'GroupDiscountSettings').catch(() => []),
      admin.entities.ServiceArea.list('sort_order', 200).catch(() => []),
    ]);

    const settings = (settingsRows || []).find((s: any) => !s.team_member_id)
      || (settingsRows || [])[0]
      || DEFAULT_GROUP_DISCOUNT_SETTINGS;
    const activeAreas = (zoneRows || []).filter((a: any) => a.active !== false);

    // A flat services list with no participants (the calendar side panel) is
    // turned into a coherent single-person participants record, or refused for a group.
    if (body.services !== undefined && body.participants === undefined) {
      const plan = planFlatServiceEdit({
        currentParticipants: booking.participants,
        services: body.services,
        addonNames: (addonRows || []).filter((a: any) => a?.is_active !== false).map((a: any) => a.name),
      });
      if (!plan.ok) return Response.json({ error: plan.error, code: 'GROUP_EDIT_REFUSED' }, { status: 400 });
      body.participants = plan.participants;
    }

    if (body.services !== undefined || body.participants !== undefined) {
      const items = recalculateBookingItems({
        services: body.services !== undefined ? body.services : booking.services,
        participants: body.participants !== undefined ? body.participants : booking.participants,
        catalogue: buildCatalogue(serviceRows || [], addonRows || []),
        settings,
        afterHoursMode: booking.after_hours_mode,
        afterHoursSlot: booking.after_hours_slot,
      });

      if (items.peopleCount < 1 || items.names.length === 0) {
        return Response.json({ error: 'A booking needs at least one service.' }, { status: 400 });
      }
      if (items.overMax) {
        return Response.json({ error: `Maximum ${items.maxPeople} people per booking.` }, { status: 400 });
      }
      if (!(items.durationMins > 0)) {
        return Response.json({
          error: 'Those services have no usable duration — check the service catalogue.',
        }, { status: 400 });
      }

      if ((booking.services || []).join(', ') !== items.names.join(', ')) changed.push('Services');
      patch.services = items.names;
      patch.participants = items.participants;
      patch.duration_mins = items.durationMins;
      patch.subtotal = Math.round(items.subtotal * 100) / 100;
      patch.price = Math.round(items.totalPrice * 100) / 100;
      patch.people_count = items.peopleCount;
      patch.is_group_booking = items.isGroupBooking;
      patch.group_discount = items.groupDiscount;
      patch.group_discount_type = items.tier ? items.tier.type : null;
      patch.group_discount_tier = items.tier ? items.tier.tier : null;
    }

    // ── Re-classify a changed address ────────────────────────────────────────
    if (patch.address) {
      const location = resolveBookingLocation({
        latitude: patch.address_lat,
        longitude: patch.address_lng,
        activeAreas,
        settings,
        day: booking.day || '',
      });
      if (!location.ok) {
        return Response.json(
          { error: location.error, code: 'COVERAGE_RESTRICTION' },
          { status: location.status || 400 },
        );
      }
      patch.location_tier = location.location_tier;
      patch.matched_service_zone_id = location.matched_service_zone_id;
      patch.matched_service_zone_name = location.matched_service_zone_name;
      patch.matched_service_zone_colour = location.matched_service_zone_colour;
      patch.distance_from_zone_km = location.distance_from_zone_km;
      patch.service_area_id = location.service_area_id;
      patch.service_area_name = location.service_area_name;
      patch.priority_status = location.priority_status;
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    // ── Write, then hand the request straight back to Route Flow ────────────
    const releaseProvisional = booking.schedule_status === 'provisional';
    const updated = await admin.entities.BookingRequest.update(booking.id, {
      ...patch,
      ...(releaseProvisional
        ? { assigned_time: null, schedule_status: 'unscheduled', availability_override: false, override_status: 'none' }
        : {}),
      // Back to Processing with no outcome recorded: the edited request can never
      // look as though the previous verdict still applies, and it stays visible
      // in Needs Action until Route Flow has re-judged it.
      // A request still held by booking protection keeps its Needs Review state
      // and stays off the schedule until an admin approves it in the queue.
      ...(booking.protection_hold === true ? {} : { ...placementPatch('processing', ''), placement_checked_at: null }),
    });

    // A confirmed booking whose service, price, window or address changed tells the customer what changed
    // (existing lifecycle mechanism; a cosmetic edit queues nothing). Never able to undo the edit.
    let customerNotice: any = null;
    try { customerNotice = await enqueueBookingEdited(admin, booking, { ...booking, ...patch }); } catch { customerNotice = null; }

    // The admin never re-runs Route Flow: the same server-side engine that places
    // new requests re-reads the edited request and decides. It either places it
    // provisionally or records why it still cannot be placed.
    let outcome: any = null;
    try {
      if (booking.protection_hold === true) throw Object.assign(new Error('Held for review, so it was not placed.'), { held: true });
      outcome = await processBookingRequest(admin, {
        bookingId: booking.id,
        actorName: actor.name,
        actorRole: 'admin',
        trigger: 'admin_panel',
      });
    } catch (engineError: any) {
      // The edit is already saved. A placement failure leaves the request
      // Processing, which is visible and actionable — never a dead end.
      outcome = { http: 500, body: { placed: false, reason: engineError?.held ? 'held_for_review' : 'engine_error', message: engineError?.message || 'Route Flow could not finish.' } };
    }

    const result = outcome?.body || {};
    const placed = result.placed === true;

    // Audit the edit itself. Field names only — never client details.
    try {
      await admin.entities.ActivityLog.create({
        action: 'booking_request_edited',
        actor: 'barber',
        summary: (placed
          ? `Booking request updated and placed at ${result.assigned_time}`
          : 'Booking request updated — not placed').slice(0, 200),
        detail: [
          changed.length ? `Changed: ${changed.join(', ')}` : 'No scheduling fields changed',
          placed
            ? `Route Flow placed it provisionally at ${result.assigned_time}`
            : `Route Flow: ${result.message || result.reason || 'no valid slot found'}`,
          `by ${actor.name}`,
        ].join(' · ').slice(0, 400),
        related_record_id: booking.id,
        related_record_type: 'BookingRequest',
        previous_value: booking.placement_status || null,
        new_value: placed ? 'placed' : (result.schedule_status || 'unscheduled'),
        timestamp: new Date().toISOString(),
      });
    } catch { /* an audit failure must never change the edit */ }

    return Response.json({
      saved: true,
      booking_request_id: booking.id,
      updated_date: updated?.updated_date || null,
      changed,
      released_slot: releaseProvisional,
      customer_notified: customerNotice?.queued === true,
      route_flow: {
        placed,
        assigned_time: result.assigned_time || null,
        schedule_status: result.schedule_status || null,
        message: result.message || null,
        reason: result.reason || null,
        candidate_count: result.candidate_count ?? null,
        skipped: result.skipped === true || false,
      },
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}