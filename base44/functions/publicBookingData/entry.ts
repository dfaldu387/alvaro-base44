import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS, getMaxServiceRadiusKm } from '../../shared/groupPricing.ts';
import { excludeTestQuery } from '../../shared/testData.ts';
import { readSettingsList } from '../../shared/settingsStore.ts';
import {
  normaliseBookingWindow,
  earliestBookableDateStr,
  latestBookableDateStr,
  bookableWindowDayCount,
  addDaysToDateStr,
  weekdayNameOf,
} from '../../shared/bookingWindow.ts';
import { hashIp, takeRateLimitSlot } from '../../shared/bookingProtection.ts';
import { busyBookings as selectBusyBookings } from '../../shared/publicBusyBookings.ts';
import { dayHasRoom, occupiedOn } from '../../shared/publicDayFit.ts';
import { secrets } from 'base44:runtime';

// One page load reads seven tables, so it is limited per caller more tightly than address search.
const PAGE_LOAD_LIMITS = { perMinute: 20, perHour: 120 };
// Bookings that count toward a date's status (declined, cancelled etc. never do).
const DEMAND_STATUSES = ['pending', 'confirmed', 'completed'];
// What the page renders from bookings: per date, the confirmed/completed count (capacity, default 8 a day),
// the pending count (only up to ~3 matters, the "in demand" threshold), and the timed confirmed/completed
// rows for busy blocks. So a day never needs more than ~10 rows. The read is capped at that many per bookable
// day (never above 500), and sorted by date so any overflow drops the furthest-away dates, not random ones.
const ROWS_PER_DAY = 10;
const MAX_BOOKINGS_READ = 500;

const IN_DEMAND_THRESHOLD = 0.31;  // 31% of capacity pending → "in_demand"
const LIMITED_THRESHOLD = 0.75;    // 75% of capacity confirmed → "limited"

// Parse assigned_time string ("1:00pm" or "13:00") to decimal hours.
function parseAssignedTime(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).toLowerCase().trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (m[3] === 'pm' && h !== 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    return h + min / 60;
  }
  const m2 = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (m2) return parseInt(m2[1], 10) + parseInt(m2[2], 10) / 60;
  const n = parseFloat(timeStr);
  return isNaN(n) ? null : n;
}

// Convert decimal hours to "HH:MM" 24h format.
function decimalToTimeStr(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Extract Sydney-zone date string and decimal hours from an ISO date-time.
function sydneyDateParts(isoStr) {
  const dt = new Date(isoStr);
  if (isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt);
  const get = (t) => parts.find(p => p.type === t)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hours: parseInt(hour, 10) + parseInt(get('minute'), 10) / 60,
  };
}

// Authoritative customer-facing status per date.
// Priority: closed → waitlist → limited → in_demand → available
// - closed: barber not working
// - waitlist: confirmed occupancy >= capacity (reported as closed, reason "full", by computeDaySummaries)
// - limited: confirmed occupancy >= 75% of capacity
// - in_demand: pending demand >= 31% of capacity, healthy occupancy
// - available: healthy occupancy + low demand
function computeCustomerStatus(isWorking, confirmedCount, pendingCount, maxCapacity) {
  if (!isWorking) return 'closed';
  if (maxCapacity <= 0) return 'closed';
  if (confirmedCount >= maxCapacity) return 'waitlist';
  if (confirmedCount >= maxCapacity * LIMITED_THRESHOLD) return 'limited';
  if (pendingCount >= Math.max(1, Math.ceil(maxCapacity * IN_DEMAND_THRESHOLD))) return 'in_demand';
  return 'available';
}

// One authoritative backend summary per date in the booking window.
// confirmed bookings = occupancy; pending requests = demand; barber hours = open/closed.
// Service Zones = geographic priority only (never affect status).
function computeDaySummaries(barberHours, activeServiceAreas, bookings, maxBookingsPerDay, bookingWindow, fit = null) {
  // The Booking Window (Booking Rules) owns which dates exist at all: the
  // summaries begin at the first date the minimum notice allows and run to the
  // booking horizon. A date outside the window therefore has no summary, so the
  // public calendar cannot offer it — and submitPublicBooking re-checks on submit.
  const firstDateStr = earliestBookableDateStr(bookingWindow, Date.now());
  const dayCount = bookableWindowDayCount(bookingWindow);

  const summaries = {};
  for (let i = 0; i < dayCount; i++) {
    const dateStr = addDaysToDateStr(firstDateStr, i);
    const dayName = weekdayNameOf(dateStr);

    const wh = (barberHours || []).find(h => h.day_of_week === dayName);
    const isWorking = !!(wh && wh.is_open && wh.open_time != null && wh.close_time != null && wh.close_time > wh.open_time);

    const priorityZones = (activeServiceAreas || [])
      .filter(a => (a.service_days || []).some(d => d.enabled && d.day_of_week === dayName))
      .map(a => ({ id: a.id, name: a.name, colour: a.colour || '#6f22cf' }));

    if (!isWorking) {
      summaries[dateStr] = {
        date: dateStr,
        day_of_week: dayName,
        is_working: false,
        customer_status: 'closed',
        priority_zones: priorityZones,
      };
      continue;
    }

    // Count by requested_date (authoritative per-date matching)
    const dayBookings = (bookings || []).filter(b => b.requested_date === dateStr);
    const confirmedCount = dayBookings.filter(b => b.status === 'confirmed' || b.status === 'completed').length;
    const pendingCount = dayBookings.filter(b => b.status === 'pending').length;
    let customerStatus = computeCustomerStatus(isWorking, confirmedCount, pendingCount, maxBookingsPerDay);
    // A day at capacity is no longer offered (it used to stay selectable as "waitlist"). A day that is under the
    // count but has no gap that could hold the shortest service is closed as well. Both only ever close a day.
    let closedReason;
    if (customerStatus === 'waitlist') { customerStatus = 'closed'; closedReason = 'full'; }
    else if (fit && customerStatus !== 'closed'
      && !dayHasRoom(wh.open_time, wh.close_time, occupiedOn(fit.rows, dateStr, fit.barberId), fit.needMins)) {
      customerStatus = 'closed'; closedReason = 'no_room';
    }

    summaries[dateStr] = {
      ...(closedReason ? { closed_reason: closedReason } : {}),
      date: dateStr,
      day_of_week: dayName,
      is_working: true,
      working_start: wh.open_time,
      working_end: wh.close_time,
      confirmed_count: confirmedCount,
      pending_count: pendingCount,
      max_capacity: maxBookingsPerDay,
      remaining_capacity: Math.max(0, maxBookingsPerDay - confirmedCount),
      customer_status: customerStatus,
      priority_zones: priorityZones,
    };
  }
  return summaries;
}

// Public endpoint — no auth required.
// Returns active services, sanitized booking data (no client PII), the
// current group-discount configuration, active Service Areas (including
// map geometry), and authoritative daySummaries (backend-computed customer
// status per date) so the public booking form renders backend status directly.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Throttled per caller. A broken counter must never stop a customer booking,
    // so a limiter failure lets the request through (same as mapboxGeocode).
    try {
      const verdict = await takeRateLimitSlot(base44.asServiceRole, 'public_booking_data', await hashIp(req), PAGE_LOAD_LIMITS);
      if (!verdict.allowed) {
        return Response.json(
          { error: 'Too many requests. Please wait a moment and try again.' },
          { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
        );
      }
    } catch (e) {
      console.error('[publicBookingData] rate limiter unavailable, allowing the request', e?.message);
    }

    // The Booking Window decides which dates the page can offer, so it also decides
    // which bookings are worth reading: only those on a date inside the window.
    const bookingRuleRows = await base44.asServiceRole.entities.BookingRules.list('-created_date', 1);
    const bookingWindow = normaliseBookingWindow((bookingRuleRows || [])[0]);
    const windowStart = earliestBookableDateStr(bookingWindow, Date.now());
    const windowEnd = latestBookableDateStr(bookingWindow, Date.now());
    const bookingReadCap = Math.min(MAX_BOOKINGS_READ, Math.max(50, bookableWindowDayCount(bookingWindow) * ROWS_PER_DAY));

    const [services, bookings, groupSettings, addonRecords, serviceAreas, teamMembers] = await Promise.all([
      base44.asServiceRole.entities.Service.list('sort_order', 100),
      base44.asServiceRole.entities.BookingRequest.filter({
        ...excludeTestQuery(),
        requested_date: { $gte: windowStart, $lte: windowEnd },
        status: { $in: DEMAND_STATUSES },
      }, 'requested_date', bookingReadCap),
      readSettingsList(base44.asServiceRole, 'GroupDiscountSettings'),
      base44.asServiceRole.entities.AddOn.list('sort_order', 100),
      base44.asServiceRole.entities.ServiceArea.list('sort_order', 200),
      base44.asServiceRole.entities.TeamMember.list('-created_date', 200),
    ]);

    const activeServices = services
      .filter(s => s.is_active !== false)
      .map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price,
        duration_mins: s.duration_mins,
        photo_url: s.photo_url,
        sort_order: s.sort_order,
      }));

    const activeAddons = (addonRecords || [])
      .filter(a => a.is_active !== false)
      .map(a => ({
        id: a.id,
        name: a.name,
        price_adjustment: a.price_adjustment || 0,
        duration_adjustment: a.duration_adjustment || 0,
        sort_order: a.sort_order,
      }));

    // Only return fields needed for busy-block calculation — no PII
    const sanitizedBookings = bookings.map(b => ({
      day: b.day,
      requested_date: b.requested_date || null,
      availability_window: b.availability_window,
      assigned_time: b.assigned_time,
      duration_mins: b.duration_mins,
      status: b.status,
    }));
    // The page draws busy blocks only from dated, timed, confirmed/completed bookings
    // (an undated booking never blocks a slot); pending ones feed only the per-date counts.
    const busyBookings = selectBusyBookings(sanitizedBookings);

    const groupDiscountSettings = (groupSettings || []).find(s => !s.team_member_id)
      || (groupSettings || [])[0]
      || DEFAULT_GROUP_DISCOUNT_SETTINGS;

    const memberNameById = {};
    for (const m of (teamMembers || [])) memberNameById[m.id] = m.name;
    const activeServiceAreas = (serviceAreas || [])
      .filter(a => a.active !== false)
      .map(a => ({
        id: a.id,
        name: a.name,
        active: true,
        team_member_id: a.team_member_id || null,
        team_member_name: a.team_member_name || memberNameById[a.team_member_id] || '',
        suburbs: a.suburbs || [],
        postcodes: a.postcodes || [],
        service_days: (a.service_days || []).map(d => ({
          day_of_week: d.day_of_week,
          enabled: !!d.enabled,
          open_time: d.open_time,
          close_time: d.close_time,
          max_bookings: d.max_bookings,
        })),
        max_bookings_per_day: a.max_bookings_per_day ?? 8,
        colour: a.colour || '#6f22cf',
        radius_km: a.radius_km ?? 10,
        centre_suburb: a.centre_suburb || '',
        latitude: a.latitude ?? null,
        longitude: a.longitude ?? null,
        geometry: a.geometry ? (typeof a.geometry === 'string' ? JSON.parse(a.geometry) : a.geometry) : null,
      }));

    const rolePriority = { owner: 0, admin: 1, barber: 2 };
    const defaultBarber = (teamMembers || [])
      .filter(m => m.is_bookable !== false && m.status === 'Active')
      .sort((a, b) => (rolePriority[a.role] ?? 9) - (rolePriority[b.role] ?? 9))[0] || null;

    const barberHours = (defaultBarber?.working_hours || []).map(wh => ({
      day_of_week: wh.day_of_week,
      is_open: wh.is_open !== false,
      open_time: wh.open_time,
      close_time: wh.close_time,
    }));

    // ── Authoritative day summaries (backend-computed customer status per date) ──
    const maxBookingsPerDay = groupDiscountSettings?.max_bookings_per_day || 8;
    // Room check: the shortest active service (+ its buffer) must fit a gap beside this barber's real bookings.
    // Same rows already read above; no extra query and no travel-time lookup, so the page costs the same to load.
    const needs = services.filter(s => s.is_active !== false && Number(s.duration_mins) > 0)
      .map(s => Number(s.duration_mins) + (Number(s.buffer_mins) || 0));
    const fit = {
      rows: bookings.map(b => ({ requested_date: b.requested_date, status: b.status, assigned_time: b.assigned_time, duration_mins: b.duration_mins, team_member_id: b.team_member_id || null })),
      barberId: defaultBarber?.id || null,
      needMins: needs.length ? Math.min(...needs) : 0,
    };
    const daySummaries = computeDaySummaries(barberHours, activeServiceAreas, sanitizedBookings, maxBookingsPerDay, bookingWindow, fit);

    // Clean coverage shape for public consumption — the single source of truth
    // shared between the admin Service Coverage page and the public booking map.
    const serviceCoverage = {
      centre: (groupDiscountSettings?.service_centre_lat != null && groupDiscountSettings?.service_centre_lng != null)
        ? { latitude: groupDiscountSettings.service_centre_lat, longitude: groupDiscountSettings.service_centre_lng }
        : null,
      extended_radius_km: groupDiscountSettings?.extended_radius_km ?? 25,
      maximum_radius_km: groupDiscountSettings?.maximum_service_radius_km ?? 35,
    };

    // Browser maps need a Mapbox *public* token (pk.). A secret (sk./tk.) token is never sent to visitors.
    const rawMapboxToken = secrets.get('CUTDELUXEMAP') || secrets.get('MAPBOX_ACCESS_TOKEN') || null;
    const mapboxToken = typeof rawMapboxToken === 'string' && rawMapboxToken.startsWith('pk.') ? rawMapboxToken : null;
    return Response.json({
      services: activeServices, addons: activeAddons, bookings: busyBookings,
      groupDiscountSettings, serviceAreas: activeServiceAreas,
      serviceCoverage,
      barberHours, barberId: defaultBarber?.id || null, barberName: defaultBarber?.name || null,
      mapboxToken,
      bookingWindow,
      daySummaries,
    });
  } catch (error) {
    console.error('[publicBookingData]', error?.message);
    return Response.json({ error: 'We could not load the booking page. Please try again.' }, { status: 500 });
  }
}