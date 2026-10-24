import { validateBookingInput } from './publicBookingValidators.ts';
import { readSettingsList } from './settingsStore.ts';
import { resolveIsTest, excludeTestQuery } from './testData.ts';
import { capacityLimit, confirmedOnDate, isAtCapacity, serverCapacityStatus } from './publicDayFit.ts';
import { isGroupBooking, DEFAULT_GROUP_DISCOUNT_SETTINGS } from './groupPricing.ts';
import { buildCatalogue, recalculateBookingItems } from './bookingItems.ts';
import { resolveBookingLocation } from './bookingLocation.ts';
import { normaliseBookingWindow, publicBookingWindowVerdict } from './bookingWindow.ts';
import { normaliseAuPhone, normaliseEmail } from './auPhone.ts';
import { resolveProtectionRules, gatherSignals, evaluateProtection, hashIp } from './bookingProtection.ts';
import { resolveWebsiteClient } from './websiteClient.ts';
import { applyBookingConsent } from './bookingConsent.ts';
import { enqueueBookingMessage } from './bookingMessages.ts';
import { createPaymentForBooking } from './paymentService.ts';
import { recordAudit } from './auditLog.ts';
import { sanitizeAdminBooking, sanitizeAdminBlock } from './adminBookingInput.ts';

/**
 * THE booking creator. The public booking form (submitPublicBooking) and the
 * AI assistant both create bookings here, so there is exactly one writer.
 *
 * Moved verbatim out of submitPublicBooking. For the public form (no `assistant`
 * option) behaviour is unchanged: the booking is saved unscheduled with no time,
 * auto-accept applies, the customer is texted and the deposit decision is made,
 * and Route Flow places it afterwards.
 *
 * The `assistant` option exists for one caller, and changes only this:
 *   - the booking is always `pending` (auto-accept never applies);
 *   - it is created ALREADY placed: the time the customer was told, with
 *     schedule_status `locked`, written in the SAME create as everything else.
 *     `locked` is what stops Route Flow auto-place and reshuffle from ever moving
 *     it (see ADMIN_UI.md). There is no second update that could fail in between;
 *   - no "received" text and no deposit request are sent from here (the assistant
 *     sends its own message through the outbox, honouring assistant_mode);
 *   - a booking that booking protection would hold is refused, not created, so the
 *     assistant never promises a time for a request a person has not approved.
 *
 * The `byAdmin` option exists for one caller too (createAdminBooking, the calendar
 * and Clients screens). It keeps every guarantee that is about the DATA and relaxes
 * only what is about a stranger on the internet:
 *   kept:    submission_token idempotency (required), catalogue price/duration/group
 *            maths, coverage tier and zone (when the address has coordinates),
 *            server-side is_test, the unknown-service refusal, the audit row;
 *   relaxed: the strict public field rules (see adminBookingInput), the booking
 *            window, capacity, booking protection and consent (a person at a desk
 *            is not a bot, and may book a same-day or full day on purpose);
 *   absent:  the customer text and the deposit request. Admin creation never sent
 *            them and still does not; confirming a booking is what texts the customer.
 * A `kind: 'block'` body writes a Block Time row in exactly the shape BlockTimeModal
 * always wrote, with the same idempotency and audit.
 *
 * Returns the HTTP status and body; the caller wraps them in a Response.
 */

export interface AdminCreate {
  /** The person, for the audit row. Never taken from the request body. */
  name: string;
  tier: 'admin' | 'staff';
  /** A barber (staff tier) can only create bookings for their own diary. */
  member_id: string | null;
}

const asRows = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

// One audit row per admin-created booking, whether this call made the booking or
// found it already made by an earlier attempt of the same save. Returns false when
// the row could not be checked or written, so the caller answers with an error and
// the page retries: a booking is never left without a record of who made it.
async function ensureAdminAudit(admin: any, byAdmin: AdminCreate, booking: any, isBlock: boolean): Promise<boolean> {
  const action = isBlock ? 'block_created_by_admin' : 'booking_created_by_admin';
  try {
    const existing = asRows(await admin.entities.ActivityLog.filter({ related_record_id: booking.id, action }, 'created_date', 1));
    if (existing.length > 0) return true;
  } catch (e) {
    console.error('[createAdminBooking] audit lookup failed', (e as Error)?.message);
    return false;
  }
  const id = await recordAudit(admin, {
    action,
    who: byAdmin.name,
    summary: isBlock ? `${byAdmin.name} blocked out time on the calendar.` : `${byAdmin.name} created a booking from the admin screens.`,
    counts: isBlock ? {} : { people: Number(booking.people_count) || 0 },
    ids: { booking_request_id: booking.id, client_id: booking.client_id || null },
    related: { type: 'BookingRequest', id: booking.id },
  });
  return !!id;
}

const AUDIT_RETRY = { status: 500, body: { error: 'Saved, but it could not be recorded in the activity log. Please try again.', retryable: true } };

// Deduplication window: bookings matching the same customer + day + window +
// services within this period return the existing record instead of a new one.
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export const ASSISTANT_BOOKING_SOURCE = 'Assistant Booking';

export interface AssistantCreate {
  conversation_id: string;
  /** The slot label the engine returned and the validator re-checked, e.g. "4:30pm". */
  assigned_time: string;
}

// Phone key from the shared helper; an unsupported number falls back to its raw
// digits so it can only ever equal an identical number.
function normPhone(p) {
  return normaliseAuPhone(p) || String(p || '').replace(/\D/g, '');
}

function normName(n) {
  return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normWindow(w) {
  return String(w || '').toLowerCase().replace(/\s+/g, '').trim();
}

function normServices(s) {
  return (Array.isArray(s) ? s : [])
    .map(x => String(x || '').toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

function isDuplicate(existing, candidate) {
  return (
    normPhone(existing.phone) === normPhone(candidate.phone) &&
    normName(existing.client_name) === normName(candidate.client_name) &&
    existing.day === candidate.day &&
    normWindow(existing.availability_window) === normWindow(candidate.availability_window) &&
    normServices(existing.services) === normServices(candidate.services)
  );
}

// The follow-up steps of a saved booking: the customer text and the deposit
// decision. Both are idempotent (keyed on the booking id), so running them again
// for a retried submission completes anything the first attempt did not finish
// and never sends or creates a second copy. A held booking gets no deposit
// request yet: that happens when an admin approves it.
async function completeFollowUps(admin, booking) {
  const messageResult = await enqueueBookingMessage(
    admin, booking, booking.status === 'confirmed' ? 'booking_confirmed' : 'booking_received',
  );
  let deposit = { required: false, amount: 0, reason: '' };
  if (booking.protection_hold !== true) {
    try {
      const { payment } = await createPaymentForBooking(admin, booking);
      deposit = { required: payment.state === 'deposit_due', amount: payment.deposit_amount || 0, reason: payment.deposit_reason || '' };
    } catch (e) {
      console.error('[submitPublicBooking] deposit check failed', e?.message);
    }
  }
  return { messageResult, deposit };
}

export async function createPublicBooking(
  admin: any,
  { body, req, assistant, byAdmin }: { body: any; req: any; assistant?: AssistantCreate | null; byAdmin?: AdminCreate | null },
): Promise<{ status?: number; body: any }> {
    const isBlock = !!byAdmin && body?.kind === 'block';
    const { valid, errors, sanitized } = byAdmin
      ? (isBlock ? sanitizeAdminBlock(body) : sanitizeAdminBooking(body))
      : validateBookingInput(body);
    if (!valid) {
      return { status: 400, body: { error: 'Validation failed', details: errors } };
    }

    // ── Test data classification (backend-authoritative) ──
    // A booking is test data when the customer's last name is TEST (trimmed,
    // case-insensitive) or when the explicit manual test flag was set. Test
    // bookings still flow through the whole system for QA, but are excluded
    // from production metrics, demand, Route Flow analytics and messaging.
    // An admin screen has no manual test flag: the rule is the last name TEST, as today.
    // A Block Time row is never test data.
    const manualTestFlag = !byAdmin && body?.manual_test_flag === true;
    const isTest = isBlock ? false : resolveIsTest(manualTestFlag, sanitized.client_name);

    // Booking-session key from the booking page (see BookingRequest.submission_token).
    // The SAME key means "this is the same submission again" — a double-click, a
    // retry after a stall, or a resend of a request that already saved — and is
    // answered with the booking that already exists. A NEW key means the customer
    // is making a new appointment, which is always created as a new request.
    const submissionToken = String(body?.submission_token || '').trim().slice(0, 64);
    // Without a token an admin save could not be told apart from a retry, which is the
    // double booking this path exists to prevent. So it is refused, never guessed.
    if (byAdmin && !submissionToken) {
      return { status: 400, body: { error: 'This save is missing its submission token. Reopen the form and try again.' } };
    }

    // ── Critical path: one parallel batch of reads, then the save ───────────
    // These five lookups are independent of each other, so they run TOGETHER:
    // the customer waits for one round trip instead of five. Nothing here waits
    // on Route Flow. Auto-placement, candidate-slot generation, Mapbox travel
    // calculations, drive/idle scoring, Stage 2 optimisation, decision logging,
    // analytics, reminders and reporting all run server-side after the request
    // has been saved — driven by the saved BookingRequest itself, so they
    // continue even if the customer closes the page.
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const [dedupRows, zoneRows, settingsRows, serviceRows, addonRows, bookingRuleRows, protectionRows, tokenRows] = await Promise.all([
      // A failed duplicate check must never block a genuine booking, so this
      // one lookup is allowed to come back empty.
      admin.entities.BookingRequest
        .filter({ created_date: { $gte: since } }, '-created_date', 50)
        .catch(() => []),
      admin.entities.ServiceArea.list('sort_order', 200),
      readSettingsList(admin, 'GroupDiscountSettings'),
      admin.entities.Service.list('sort_order', 200),
      admin.entities.AddOn.list('sort_order', 200),
      // Booking Window — the same setting Route Flow and the calendar enforce.
      admin.entities.BookingRules.list('-created_date', 1),
      // Protection limits. If they cannot be read the saved defaults apply and the
      // booking is still taken.
      admin.entities.BookingProtectionRules.list('-created_date', 1).catch(() => []),
      // A retried submission is found by its key whenever the first attempt was
      // made, not only inside the short duplicate window. This read is NOT allowed
      // to fail quietly: a failure returns an error, the page retries, and a second
      // booking is never created by guesswork.
      submissionToken
        ? admin.entities.BookingRequest.filter({ submission_token: submissionToken }, 'created_date', 5)
        : Promise.resolve([]),
    ]);

    // Server-side duplicate detection.
    //   • With a session key: only a resend of THAT submission matches, so a retry
    //     can never create a second record while a new appointment always does.
    //   • Without one (a direct call to this endpoint): the original customer +
    //     day + window + service comparison still guards against duplicates.
    const tokenMatch = (tokenRows || [])[0];
    if (tokenMatch && byAdmin) {
      // The same save again. A retry may not flip a booking between the test and
      // real universes (a renamed client), so that is refused rather than answered.
      if ((tokenMatch.is_test === true) !== isTest) {
        return { status: 409, body: { error: 'This save was already made with different details. Close the form and start again.' } };
      }
      if (!(await ensureAdminAudit(admin, byAdmin, tokenMatch, isBlock))) return AUDIT_RETRY;
      return { body: { success: true, id: tokenMatch.id, duplicate: true, booking: tokenMatch } };
    }
    if (tokenMatch) {
      // Same submission again: answer with the original, and finish anything the
      // first attempt did not (message, deposit). Nothing new is created.
      if (assistant) return { body: { success: true, id: tokenMatch.id, duplicate: true } };
      const follow = await completeFollowUps(admin, tokenMatch);
      return { body: {
        success: true, id: tokenMatch.id, duplicate: true, deposit: follow.deposit,
        message_queued: follow.messageResult.queued === true, client_id: tokenMatch.client_id || null,
      } };
    }
    const match = submissionToken ? null : (dedupRows || []).find(r => isDuplicate(r, sanitized));
    if (match) {
      return { body: { success: true, id: match.id, duplicate: true } };
    }

    // ── Block Time: its own short path, the shape BlockTimeModal always wrote ──
    if (isBlock) {
      const blockRow = { ...sanitized, is_test: false, submission_token: submissionToken };
      const createdBlock = await admin.entities.BookingRequest.create(blockRow);
      const sameKey = asRows(await admin.entities.BookingRequest.filter({ submission_token: submissionToken }, 'created_date', 5));
      const winnerBlock = sameKey[0];
      if (winnerBlock && winnerBlock.id !== createdBlock.id) {
        await admin.entities.BookingRequest.delete(createdBlock.id);
        if (!(await ensureAdminAudit(admin, byAdmin!, winnerBlock, true))) return AUDIT_RETRY;
        return { body: { success: true, id: winnerBlock.id, duplicate: true, booking: winnerBlock } };
      }
      if (!(await ensureAdminAudit(admin, byAdmin!, createdBlock, true))) return AUDIT_RETRY;
      return { body: { success: true, id: createdBlock.id, booking: createdBlock } };
    }

    // ── Admin only: the client and the barber must be real, and in the right universe ──
    // A failed read here is an error the page retries, never an assumption.
    let adminClientId: string | null = null;
    let adminTeam: Record<string, string> = {};
    if (byAdmin) {
      if (body?.client_id) {
        let client: any = null;
        try { client = await admin.entities.ReminderClient.get(String(body.client_id)); } catch { client = null; }
        if (!client) return { status: 400, body: { error: 'That client could not be found. Pick the client again.' } };
        if ((client.is_test === true) !== isTest) {
          return { status: 409, body: { error: 'A test client and a real booking (or the reverse) cannot be linked.' } };
        }
        adminClientId = client.id;
      }
      const wantedMember = byAdmin.tier === 'staff' ? byAdmin.member_id : (body?.team_member_id || null);
      if (wantedMember) {
        let member: any = null;
        try { member = await admin.entities.TeamMember.get(String(wantedMember)); } catch { member = null; }
        if (!member) return { status: 400, body: { error: 'That team member could not be found.' } };
        adminTeam = { team_member_id: member.id, team_member_name: member.name };
      }
    }

    // ── Booking window — the single rule owned by Booking Rules ──────────────
    // Enforced here regardless of what the browser allowed, so a bypassed or
    // stale date selector can never book outside the configured window. The
    // window is measured in Sydney wall-clock time, DST-safe.
    const bookingWindow = normaliseBookingWindow((bookingRuleRows || [])[0]);
    // No saved record (or no saved value) means review stays manual.
    const autoAccept = (bookingRuleRows || [])[0]?.auto_accept_requests === true;
    // An admin may book a same-day or far-future slot on purpose.
    const windowCheck = byAdmin ? { ok: true } as any : publicBookingWindowVerdict({
      dateStr: sanitized.requested_date,
      availabilityWindow: sanitized.availability_window,
      afterHoursSlot: sanitized.after_hours_slot,
      window: bookingWindow,
    });
    if (!windowCheck.ok) {
      return {
        status: 400,
        body: { error: windowCheck.error, code: windowCheck.code, details: [windowCheck.error] },
      };
    }

    // ── Authoritative server-side service coverage calculation ──
    // The backend is the source of truth. Frontend-provided tier, matched
    // zone, distance, and eligibility values are NEVER trusted — they are
    // recalculated here from the saved Service Coverage configuration. A user
    // cannot bypass the Maximum Radius by editing frontend JS, sending a fake
    // tier, supplying a fake matched zone ID, or calling this endpoint directly.
    const activeAreas = (zoneRows || []).filter((a) => a.active !== false);

    // Authoritative group-discount settings (business default) — used for the
    // coverage radius thresholds, the group maximum and the discount tiers.
    const settingsRecord = (settingsRows || []).find(s => !s.team_member_id) || (settingsRows || [])[0] || null;
    const groupDiscountSettings = settingsRecord || DEFAULT_GROUP_DISCOUNT_SETTINGS;

    // Coordinates are required (validated server-side) — use them directly.
    const geocoded = (sanitized.address_lat != null && sanitized.address_lng != null)
      ? { lat: sanitized.address_lat, lng: sanitized.address_lng }
      : null;

    // The public form must have verified coordinates. An admin screen types a plain
    // address, so without coordinates the booking is saved with no coverage tier
    // (it is classified the moment the address is picked from the suggestions).
    if (!geocoded && !byAdmin) {
      return { status: 400, body: { error: "We couldn't verify your service address. Please select it again." } };
    }

    // ── Location: coverage tier, matched zone, and the zone for the date ─────
    // Shared with the admin edit endpoint so an edited address is classified by
    // exactly the same rules as a submitted one.
    const resolved = geocoded
      ? resolveBookingLocation({
        latitude: geocoded.lat,
        longitude: geocoded.lng,
        activeAreas,
        settings: groupDiscountSettings,
        day: sanitized.day,
      })
      : null;
    if (resolved && !resolved.ok) {
      return { status: resolved.status || 400, body: { error: resolved.error } };
    }
    const location: any = resolved || {};
    const {
      location_tier,
      matched_service_zone_id,
      matched_service_zone_name,
      matched_service_zone_colour,
      distance_from_zone_km,
      service_area_id,
      service_area_name,
      priority_status,
      service_zone_id,
      service_zone_name,
      service_zone_colour,
      team_member_id,
      team_member_name,
    } = location;

    // ── Price, duration and group size from the catalogue ────────────────────
    // Never trust the frontend price. The same catalogue maths is used when an
    // admin edits a request (shared/bookingItems), so both paths agree.
    // A client-request placeholder (the Add Client form) has no services, so nothing is priced.
    const hasItems = !byAdmin || (sanitized.participants || []).length > 0;
    if (byAdmin && hasItems) {
      // A name that is not in the catalogue would be priced at $0 and timed at 0 minutes:
      // refuse it by name instead of saving a free booking.
      const nameOf = (x: any) => String(x?.name || '').trim().toLowerCase();
      const known = new Set([
        ...(serviceRows || []).filter((s: any) => s.is_active !== false).map(nameOf),
        ...(addonRows || []).filter((a: any) => a.is_active !== false).map(nameOf),
      ]);
      // Add-ons are priced from the same catalogue, so an unknown one is refused too
      // rather than quietly added for free.
      const chosen = sanitized.participants.flatMap((p: any) => [p.primary_service, ...(Array.isArray(p.addons) ? p.addons : [])]);
      const unknown = [...new Set<string>(chosen.filter((n: string) => !known.has(String(n).toLowerCase())))];
      if (unknown.length > 0) {
        return { status: 400, body: { error: `Not in the service catalogue: ${unknown.join(', ')}.`, details: unknown } };
      }
    }
    const items = recalculateBookingItems({
      services: byAdmin ? (sanitized.participants || []).map((p: any) => p.primary_service) : sanitized.services,
      participants: sanitized.participants || [],
      catalogue: buildCatalogue(serviceRows || [], addonRows || []),
      settings: groupDiscountSettings,
      afterHoursMode: sanitized.after_hours_mode,
      afterHoursSlot: sanitized.after_hours_slot,
    });
    if (byAdmin && hasItems && !(items.durationMins > 0)) {
      return { status: 400, body: { error: 'Those services have no usable duration. Check the service catalogue.' } };
    }
    const { subtotal, durationMins, peopleCount, maxPeople, tier, groupDiscount, totalPrice } = items;

    // Server-side enforcement of the configurable maximum group size. This is
    // authoritative — the frontend limit is convenience only. A manipulated
    // request with too many participants is rejected before any record is created.
    if (items.overMax) {
      return {
        status: 400,
        body: { error: `Maximum ${maxPeople} people per group booking.`, details: ['This booking exceeds the maximum group size.'] },
      };
    }

    // Capacity is recomputed here from the stored bookings: the browser's capacity_status_at_submission is never
    // trusted. Rule: a request for a day already at its limit is saved IN FULL but held for a person (Needs Review,
    // with the reason), not declined: the barber may want the work. If the count cannot be read, it is held too.
    let atCapacity = false;
    let capacityStatus = 'available';
    let capacityReason = '';
    // An admin creating a booking gets the SAME verdict, reported only: it is never held, never
    // waitlisted and never refused (the person at the desk decides). Block Time has no capacity.
    if (!isTest && !isBlock && sanitized.requested_date) {
      try {
        const dayRows = await admin.entities.BookingRequest.filter({ requested_date: sanitized.requested_date, status: { $in: ['confirmed', 'completed'] }, ...excludeTestQuery() }, '-created_date', 500);
        const max = capacityLimit(groupDiscountSettings);
        const confirmed = confirmedOnDate(Array.isArray(dayRows) ? dayRows : (dayRows?.items || []), sanitized.requested_date);
        atCapacity = !byAdmin && isAtCapacity(confirmed, max);
        capacityStatus = serverCapacityStatus(confirmed, max);
        if (isAtCapacity(confirmed, max)) capacityReason = `This day already has ${confirmed} confirmed bookings (limit ${max}).`;
      } catch (e) {
        console.error('[submitPublicBooking] capacity check failed', e?.message);
        atCapacity = !byAdmin;
        capacityReason = 'The day\u2019s capacity could not be checked, so a person should look at this request.';
      }
    }
    const waitlist = atCapacity;

    // ── Auto-placement is handled by Route Flow ──────────────────────────
    // Booking requests are created as unscheduled. The Route Flow workflow
    // triggers on creation and places the booking if Route Flow is enabled
    // in auto-place mode. This keeps placement logic server-side and
    // independent of any client page being open.
    // (Assistant bookings are the one exception: they are created already placed
    // and locked — see the header of this file.)
    const assigned_time = assistant ? assistant.assigned_time : null;
    const schedule_status = assistant ? 'locked' : 'unscheduled';

    // ── CRM link: find or create the ReminderClient for this booking ─────────
    // Test bookings only ever touch test clients and real bookings only real
    // ones (see shared/websiteClient). A failure here never loses the booking,
    // but it is reported in the response (client_link) instead of hidden.
    let clientLink: any = { status: 'failed', client_id: null, matched_by: null };
    // An admin screen names the client itself (verified above); it never creates or matches one by guesswork.
    if (byAdmin) clientLink = { status: adminClientId ? 'linked' : 'none', client_id: adminClientId, matched_by: null };
    else try {
      clientLink = await resolveWebsiteClient(admin, sanitized, isTest);
    } catch (e) {
      console.error('[submitPublicBooking] client link failed', e?.message);
    }

    // Booking-form consent checkbox: true only when explicitly ticked.
    const messagingConsent = !byAdmin && body?.messaging_consent === true;
    if (!byAdmin) try {
      await applyBookingConsent(admin, clientLink, messagingConsent);
    } catch (e) {
      console.error('[submitPublicBooking] consent apply failed', e?.message);
    }

    // ── Booking protection ───────────────────────────────────────────────────
    // Looks at how many requests share this phone (normalised, so formatting never
    // matters), email and connection. When something looks wrong the booking is
    // still saved, in full, but held for a person (placement_status needs_review)
    // and kept off the schedule until an admin approves it. A group is ONE
    // request, so it counts as one submission. If the checks cannot run, the
    // request is held too: in doubt, a human looks. Nothing is rejected or dropped.
    const phoneKey = normaliseAuPhone(sanitized.phone);
    const emailKey = normaliseEmail(sanitized.email);
    const ipHash = byAdmin ? null : await hashIp(req).catch(() => null);
    const protectionRules = resolveProtectionRules((protectionRows || [])[0]);
    let protection: any = { hold: false, reasons: [], codes: [] };
    // Booking protection is about strangers; a person creating a booking is not held by it.
    if (!byAdmin) try {
      const signals = await gatherSignals(admin, {
        phoneKey, emailKey, ipHash, name: sanitized.client_name, candidate: sanitized, rules: protectionRules,
      });
      protection = evaluateProtection({
        rules: protectionRules, signals,
        // The customer's own name: the booking record keeps it as client_name, so
        // the contact check is handed the value it actually reads.
        contact: { name: sanitized.client_name, phone: sanitized.phone, email: sanitized.email },
        location: { tier: location_tier, distanceKm: distance_from_zone_km },
      });
    } catch (e) {
      console.error('[submitPublicBooking] protection checks failed', e?.message);
      if (protectionRules.enabled) {
        protection = { hold: true, reasons: ['The automatic checks could not run, so a person should look at this request.'], codes: ['check_failed'] };
      }
    }
    if (atCapacity) {
      protection = { hold: true, reasons: [capacityReason, ...protection.reasons], codes: ['over_capacity', ...protection.codes] };
    }
    const hold = protection.hold;

    // The assistant never promises a time for a request a person has not approved.
    if (assistant && hold) {
      return { body: { success: false, refused: 'held', reasons: protection.reasons } };
    }

    const { service_items: _serviceItems, ...adminFields } = sanitized as any;
    const recordBase = byAdmin
      ? { ...adminFields, ...(hasItems ? { services: items.names, participants: items.participants } : {}) }
      : sanitized;
    const record = {
      ...recordBase,
      ...(byAdmin ? {} : { messaging_consent: messagingConsent }),
      ...(messagingConsent ? { messaging_consent_at: new Date().toISOString() } : {}),
      // Auto-accept (Booking Rules): accepted on submission, no admin review.
      // Read from the persisted record above; only a saved `true` enables it.
      // Acceptance is separate from placement — Route Flow still places it.
      // A held request is never auto-accepted.
      ...(autoAccept && !hold && !assistant && !byAdmin ? { status: 'confirmed' } : {}),
      ...(clientLink.client_id ? { client_id: clientLink.client_id } : {}),
      waitlist,
      capacity_status_at_submission: capacityStatus,
      service_area_id,
      service_area_name,
      service_zone_id,
      service_zone_name,
      service_zone_colour,
      team_member_id,
      team_member_name,
      priority_status,
      location_tier,
      distance_from_zone_km,
      matched_service_zone_id,
      matched_service_zone_name,
      matched_service_zone_colour,
      ...(hasItems ? {
        subtotal: Math.round(subtotal * 100) / 100,
        price: Math.round(totalPrice * 100) / 100,
        duration_mins: durationMins,
        people_count: peopleCount,
        is_group_booking: isGroupBooking(peopleCount),
        group_discount: groupDiscount,
        group_discount_type: tier ? tier.type : null,
        group_discount_tier: tier ? tier.tier : null,
      } : {}),
      ...adminTeam,
      assigned_time,
      schedule_status,
      // Test classification is decided server-side — a frontend value can never
      // promote test data into production or hide it.
      is_test: isTest,
      // Recorded so a resend of this same submission is recognised as a retry.
      submission_token: submissionToken || null,
      // The request is saved and waiting for Route Flow. This is "Processing",
      // never a failure — the engine writes the real outcome when it runs, so a
      // booking can never be invisible between saving and being placed.
      phone_normalised: phoneKey || null,
      email_normalised: emailKey || null,
      submitter_ip_hash: ipHash || null,
      ...(hold
        ? {
            protection_hold: true,
            protection_reasons: protection.reasons,
            protection_codes: protection.codes,
            placement_status: 'needs_review',
            placement_reason: `Held for review: ${protection.reasons[0]}${protection.reasons.length > 1 ? ` (+${protection.reasons.length - 1} more)` : ''}`.slice(0, 300),
          }
        : { placement_status: 'processing', placement_reason: '' }),
      // Assistant bookings: pending, already placed and LOCKED, all in this one write.
      ...(assistant
        ? {
            status: 'pending',
            booking_source: ASSISTANT_BOOKING_SOURCE,
            placement_status: 'placed',
            placement_reason: '',
            locked_at: new Date().toISOString(),
            locked_by: 'Assistant (time offered to the customer)',
            assistant_conversation_id: assistant.conversation_id,
            assistant_promised_time: assistant.assigned_time,
          }
        : {}),
    };

    const created = await admin.entities.BookingRequest.create(record);

    // Two simultaneous sends of the same submission can both pass the lookup
    // above. The earliest record wins; the later one removes itself and answers
    // with the winner, before any message or payment is created for it.
    if (submissionToken) {
      const sameKey = await admin.entities.BookingRequest.filter({ submission_token: submissionToken }, 'created_date', 5);
      const winner = (sameKey || [])[0];
      if (winner && winner.id !== created.id) {
        await admin.entities.BookingRequest.delete(created.id);
        if (byAdmin) {
          if (!(await ensureAdminAudit(admin, byAdmin, winner, false))) return AUDIT_RETRY;
          return { body: { success: true, id: winner.id, duplicate: true, booking: winner } };
        }
        if (assistant) return { body: { success: true, id: winner.id, duplicate: true } };
        const follow = await completeFollowUps(admin, winner);
        return { body: { success: true, id: winner.id, duplicate: true, deposit: follow.deposit, message_queued: follow.messageResult.queued === true } };
      }
    }

    // Admin creation: audited, and no customer text or deposit request (see the header).
    if (byAdmin) {
      if (!(await ensureAdminAudit(admin, byAdmin, created, false))) return AUDIT_RETRY;
      return { body: {
        success: true, id: created.id, booking: created, is_test: isTest, client_id: clientLink.client_id,
        capacity_status_at_submission: capacityStatus, capacity_reason: capacityReason || null,
      } };
    }

    // Assistant bookings send nothing from here: the assistant's own message
    // (assistant_mode decides whether it waits for a tap) is the only text.
    if (assistant) {
      return { body: { success: true, id: created.id, schedule_status, status: 'pending', assigned_time, client_id: clientLink.client_id } };
    }

    // Customer text and deposit decision (see completeFollowUps). An auto-accepted
    // booking gets the confirmation instead of "received"; a held one gets
    // "received" and no deposit request until it is approved.
    const { messageResult, deposit } = await completeFollowUps(admin, { ...record, ...created });

    return { body: {
      deposit,
      success: true, id: created.id, schedule_status, is_test: isTest,
      message_queued: messageResult.queued === true,
      auto_accepted: autoAccept && !hold, status: created.status || record.status,
      client_id: clientLink.client_id, client_link: clientLink.status,
    } };
}