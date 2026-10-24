import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { decimalToLabel, snapDecimal } from '@/lib/timeUtils';
import { format, addDays, subDays, startOfWeek, addWeeks, subWeeks } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import RequestsDrawer from '@/components/schedule/RequestsDrawer';
import RequestsTab from '@/components/schedule/RequestsTab';
import CalendarToolbar from '@/components/schedule/CalendarToolbar';
import CalendarOverlays from '@/components/schedule/CalendarOverlays';
import useRequestPlacement from '@/hooks/useRequestPlacement';
import useBlockActions from '@/hooks/useBlockActions';
import useRequestsDeepLink from '@/hooks/useRequestsDeepLink';
import DayTimeline from '@/components/schedule/DayTimeline';
import AppointmentDetailPanel from '@/components/schedule/AppointmentDetailPanel';
import { ScheduleToastContainer } from '@/components/schedule/ScheduleToast';
import { createAdminClients } from '@/lib/adminBookingApi';
import WeekGrid from '@/components/schedule/WeekGrid';
import CalendarSkeleton from '@/components/schedule/CalendarSkeleton';
import ErrorState from '@/components/states/ErrorState';
import { reqToAppt, isPlacedOnCalendar, apptStatusToDbStatus } from '@/lib/appointmentUtils';
import { dateKey } from '@/lib/dateScope';
import { buildClientSignals, isNewClientBooking, countNewClientsInMonth } from '@/lib/clientSignals';
import { useTeamMembers, getUnionHours, DEFAULT_WORKING_HOURS } from '@/lib/businessHoursUtils';
import { applyManualPlacement, unscheduleBooking } from '@/lib/manualPlacement';
import { loadTimingCatalogue, bufferMinutesFor } from '@/lib/appointmentTiming';
import { placementRefusalMessage } from '@/lib/placementValidation';
import { travelWarning } from '@/lib/travelWarning';
import { isNeedsAction } from '@/lib/requestStatus';
import { findDayConflicts, conflictSummary } from '@/lib/scheduleConflicts';
import RouteConflictBanner from '@/components/route/RouteConflictBanner';
import ManualSchedulingHint from '@/components/schedule/ManualSchedulingHint';
import AvailabilityNotice from '@/components/schedule/AvailabilityNotice';
import RouteSummaryCard from '@/components/schedule/RouteSummaryCard';
import ConfirmAppointmentsDialog from '@/components/schedule/ConfirmAppointmentsDialog';
import {
  loadDayRouteState, loadDayDriveLegs, disconnectDayRoute, confirmDayAppointments,
} from '@/lib/dayRouteStatus';
import { loadReplyFlags, replyState } from '@/lib/replyFlags';
import { declineBookingRequest, bookingTransition } from '@/lib/requestAdmin';
import { deleteBlockTime } from '@/lib/blockTime';

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

let toastIdCounter = 0;

import useCalendarAutoSync from '@/hooks/useCalendarAutoSync';
import useConnectAppointments from '@/hooks/useConnectAppointments';
import { useIsMobile } from '@/hooks/use-mobile';

export default function Schedule() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const { members: staffMembers } = useTeamMembers();
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const businessHours = selectedStaffId
    ? (staffMembers.find(m => m.id === selectedStaffId)?.working_hours || DEFAULT_WORKING_HOURS)
    : getUnionHours(staffMembers);

  // All BookingRequests — both pending and scheduled
  const [allRequests, setAllRequests] = useState([]);
  // Client records — the source of truth for Favourite status
  const [clients, setClients] = useState([]);
  // Appointments derived from scheduled BookingRequests (persistent, loaded from DB)
  const [appointments, setAppointments] = useState([]);
  // Live services catalogue — the one source of every appointment's configured
  // buffer. Loaded with the schedule and reused by the manual-booking handlers.
  const timingCatalogueRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Only the FIRST load blanks the grid. Every later refresh is silent, so the week
  // never disappears from under the barber's hands.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Raised by "Today" to scroll the grid to the live time.
  const [scrollToNow, setScrollToNow] = useState(0);
  // Appointments with a save still in flight, so each card can say "Saving…" on its own.
  const [savingIds, setSavingIds] = useState(() => new Set());
  // The day's route: its connected state, and the drive legs a connected day stored.
  const [dayRoute, setDayRoute] = useState(null);
  const [driveLegs, setDriveLegs] = useState(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // `silent` reloads keep whatever is on screen: no spinner, no cleared grid and no
  // error banner — the calendar simply updates when the answer arrives.
  const loadSchedule = useCallback((opts = {}) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    setLoadError(null);
    return Promise.all([
      base44.entities.BookingRequest.list('-created_date', 500),
      base44.entities.ReminderClient.list('-created_date', 500),
      loadTimingCatalogue(base44),
      loadReplyFlags(),
      // Repeating blocks and appointments: what lets a block's menu offer
      // "this / this and future / entire series".
      base44.entities.AppointmentSeries.list('-created_date', 200).catch(() => []),
    ]).then(([reqs, clientRecords, catalogue, replyFlags, seriesRows]) => {
      timingCatalogueRef.current = catalogue;
      setAllRequests(reqs);
      setClients(clientRecords);
      const seriesByBooking = {};
      (seriesRows || []).forEach(s => (s.booking_request_ids || []).forEach(id => { seriesByBooking[id] = s; }));
      // Each block carries its real occupancy: service + that booking's OWN
      // configured buffer, never a shared default.
      const appts = reqs
        .filter(r => isPlacedOnCalendar(r))
        .map(r => reqToAppt(r, bufferMinutesFor(r, catalogue)))
        .filter(Boolean)
        .map(a => ({ ...a, ...replyState(a.requestId, replyFlags) }))
        .map(a => {
          const series = seriesByBooking[a.requestId];
          return series
            ? {
              ...a,
              series_id: series.id,
              series_frequency: series.frequency_label || '',
              series_count: (series.booking_request_ids || []).length,
            }
            : a;
        });
      setAppointments(appts);
      return true;
    }).catch(() => { if (!silent) setLoadError(true); return false; })
      .finally(() => { setLoading(false); setHasLoaded(true); });
  }, []);

  const [detailAppt, setDetailAppt] = useState(null);
  const [rangeMode, setRangeMode] = useState('week');
  const [toasts, setToasts] = useState([]);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  // A blocked time opened from its own card is held by useBlockActions.
  const [prefillTime, setPrefillTime] = useState(null);
  // A dragged range on the calendar: a preview of how long the barber has in mind.
  // The service catalogue still decides the appointment's real duration.
  const [prefillMins, setPrefillMins] = useState(null);
  // Locked/confirmed appointments (derived from schedule_status) — Auto Sort must not move these
  const lockedIds = new Set(appointments.filter(a => a.schedule_status === 'locked' || a.schedule_status === 'confirmed').map(a => a.id));
  const [protectionSettings, setProtectionSettings] = useState({
    auto_lock_confirmed: true,
    allow_manual_move_locked: true,
    allow_manual_move_confirmed: true,
  });
  const [currentUserName, setCurrentUserName] = useState('Admin');
  // Booking Window override — an administrator scheduling outside the Booking
  // Rules window confirms through the same "Schedule Anyway" flow used for
  // availability, and the override reason is recorded in the audit trail.
  const [windowOverridePrompt, setWindowOverridePrompt] = useState(null);
  // ── What the Calendar tells the barber, and what it asks them ─────────────
  // The amber bar: a placement outside the client's preferred availability has
  // ALREADY been saved and the client is being asked to confirm it. The dialog:
  // travel that cannot be achieved, which only the barber can decide.
  const [availabilityNotice, setAvailabilityNotice] = useState(null);
  const [travelPrompt, setTravelPrompt] = useState(null);
  const [travelBusy, setTravelBusy] = useState(false);

  // The amber bar reports something that already happened, so it clears itself.
  useEffect(() => {
    if (!availabilityNotice) return undefined;
    const timer = setTimeout(() => setAvailabilityNotice(null), 12000);
    return () => clearTimeout(timer);
  }, [availabilityNotice]);

  const addToast = useCallback((toast) => {
    const id = ++toastIdCounter;
    setToasts([{ id, ...toast }]);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // One card's save in flight. Held per appointment so the calendar is never blocked
  // as a whole while the server answers.
  const markSaving = useCallback((id, on = true) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  // ── Placing a request: the right-side panel, the drag, and the drop ────────
  // The day the calendar is focused on is the day the panel lists, so a request is
  // always dragged onto the day it was chosen for.
  const {
    open: requestsOpen, openPanel, closePanel,
    placement, ghost, busyId: placeBusyId,
    overridePrompt, overrideBusy, cancelOverride, confirmOverride,
    placeAnyway,
    beginPlacement, applyHover,
  } = useRequestPlacement({
    bufferFor: useCallback((req) => bufferMinutesFor(req, timingCatalogueRef.current), []),
    onPlaced: () => { loadSchedule({ silent: true }); refreshDayRoute(); },
    // A request dropped outside the client's preferred availability is saved and the
    // client is asked to confirm the new time. The barber is told, never asked.
    onOverridePlaced: ({ request, time }) => setAvailabilityNotice({
      title: 'Placed outside preferred availability',
      detail: `A confirmation SMS is being sent to ${request?.client_name || 'the client'} for ${time || 'the new time'}. The time stays editable until they reply.`,
    }),
    // Travel that cannot be achieved is the barber's decision: the shortfall is put
    // to them with its facts, and their "Place Anyway" is what writes it.
    onTravelRequired: ({ request, startDecimal, date, dayName, result }) => {
      setTravelPrompt({
        ...travelWarning(result, startDecimal),
        clientName: request?.client_name,
        timeLabel: decimalToLabel(startDecimal),
        onPlaceAnyway: () => {
          setTravelPrompt(null);
          setTravelBusy(true);
          Promise.resolve(placeAnyway({ request, startDecimal, date, dayName }))
            .finally(() => setTravelBusy(false));
        },
      });
    },
    notify: addToast,
  });

  // Dragging a request onto the grid needs the panel and the week side by side. A phone
  // shows the panel over the calendar, so there the request is placed from its ⋯ menu
  // instead — the panel never offers a drag it cannot finish.
  const isMobile = useIsMobile();
  const canDragRequests = rangeMode !== 'day' && !isMobile;


  // ── Load everything from DB on mount ──────────────────────────────────────
  useEffect(() => { loadSchedule(); }, [loadSchedule]);
  useCalendarAutoSync(() => loadSchedule({ silent: true }));

  // ── Load protection settings and current user ────────────────────────────
  useEffect(() => {
    base44.entities.SchedulingSettings.list('-created_date', 1)
      .then(records => {
        if (records.length > 0) setProtectionSettings(prev => ({ ...prev, ...records[0] }));
      })
      .catch(() => {});
    base44.auth.me()
      .then(u => {
        if (u?.full_name) setCurrentUserName(u.full_name);
        else if (u?.email) setCurrentUserName(u.email);
      })
      .catch(() => {});
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  // The visible day is a real calendar date (YYYY-MM-DD) — weekdays are only
  // used for business-hour lookups, never to select records.
  const selectedDateKey = dateKey(selectedDate);
  const selectedDayName = DAY_NAMES[selectedDate.getDay()];
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const displayDays = rangeMode === 'week' ? weekDays : rangeMode === '4days' ? Array.from({ length: 4 }, (_, i) => addDays(selectedDate, i)) : [selectedDate];
  // ── Client signals: Favourite (client record) + NEW (booking history) ────
  // Attached to the appointment objects the calendar renders, so cards, day
  // blocks and the detail panel all read exactly the same values.
  const signals = useMemo(() => buildClientSignals(clients, allRequests), [clients, allRequests]);
  const decoratedAppointments = useMemo(() => appointments.map(a => {
    const sig = signals.lookup(a.clientName);
    return {
      ...a,
      is_favourite: sig?.isFavourite === true,
      is_new_client: isNewClientBooking(a.requestId, a.is_test, sig),
    };
  }), [appointments, signals]);
  const dayAppts = decoratedAppointments.filter(a => a.date === selectedDateKey);
  // What Connect Appointments acts on: the chosen day's real appointments, blocks
  // excluded, and whether every one of their times is already fixed.
  const routeAppointments = decoratedAppointments.filter(a => a.date === selectedDateKey && !a.isBlock
    && !['cancelled', 'completed', 'no_show'].includes(a.status)
    && (!selectedStaffId || a.teamMemberId === selectedStaffId || !a.teamMemberId));
  const allTimesConfirmed = routeAppointments.length > 0
    && routeAppointments.every(a => a.schedule_status === 'confirmed');
  // Two appointments the same barber cannot serve at once. Stated on the day, and
  // Confirm Appointments refuses to run while one exists — the server refuses each
  // one too, so a double booking can never be promised to two clients.
  const dayConflicts = useMemo(() => findDayConflicts(routeAppointments), [routeAppointments]);
  // The day's stored drive legs are drawn for as long as they exist: a route segment is
  // never hidden from the calendar. A route the day has outgrown is stated by the day
  // bar above, which asks for a reconnect — the legs stay on screen until it is rebuilt.
  const calendarLegs = driveLegs;

  const visibleFrom = dateKey(displayDays[0]);
  const visibleTo = dateKey(displayDays[displayDays.length - 1]);
  const routeReadVersion = useRef(0);
  const refreshDayRoute = useCallback(async () => {
    const version = ++routeReadVersion.current;
    const [state, legs] = await Promise.all([
      loadDayRouteState(selectedDateKey, selectedStaffId),
      loadDayDriveLegs(visibleFrom, visibleTo),
    ]);
    if (version !== routeReadVersion.current) return;
    setDayRoute(state || null);
    setDriveLegs(legs || {});
  }, [selectedDateKey, selectedStaffId, visibleFrom, visibleTo]);

  useEffect(() => {
    refreshDayRoute();
    return () => { routeReadVersion.current += 1; };
  }, [refreshDayRoute]);
  const newClientsThisMonth = useMemo(
    () => countNewClientsInMonth(allRequests, signals, format(selectedDate, 'yyyy-MM')),
    [allRequests, signals, selectedDate]
  );
  // The open panel always shows the latest flags (so a toggle is reflected instantly)
  const detailApptView = detailAppt
    ? (decoratedAppointments.find(a => a.id === detailAppt.id) || detailAppt)
    : null;

  // Unresolved requests for exactly the date the calendar is showing — anything
  // the admin still has to place. A request Route Flow could not place stays in
  // this list with its reason instead of dropping out of view; requests already on
  // the timeline are shown there, and resolved ones are on the Bookings page.
  const openRequests = allRequests.filter(r =>
    r.requested_date === selectedDateKey && isNeedsAction(r)
  );
  const openRequestsDayLabel = format(selectedDate, 'EEE d MMM');

  // A link that named a filter opens the drawer on it, on a day that has one.
  const drawerFilter = useRequestsDeepLink({
    openPanel,
    requests: openRequests,
    allRequests,
    loaded: hasLoaded,
    onFocusDate: setSelectedDate,
  });

  // The Calendar is a planning board, not a route: nothing has to be connected
  // before an appointment can be moved, and an outside-preference placement is
  // saved with the client asked to confirm it. The Route tab builds the day's
  // route when the barber is ready for one.

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToPrevWeek = () => { const n = subWeeks(weekStart, 1); setWeekStart(n); const d = selectedDate.getDay(); setSelectedDate(addDays(n, d)); };
  const goToNextWeek = () => { const n = addWeeks(weekStart, 1); setWeekStart(n); const d = selectedDate.getDay(); setSelectedDate(addDays(n, d)); };
  const goToPrevDay = () => { const p = subDays(selectedDate, 1); setSelectedDate(p); if (p < weekStart) setWeekStart(subWeeks(weekStart, 1)); };
  const goToNextDay = () => { const n = addDays(selectedDate, 1); setSelectedDate(n); if (n >= addDays(weekStart, 7)) setWeekStart(addWeeks(weekStart, 1)); };
  // "Today" also brings the live time into view, so the button does what it promises.
  const goToToday = () => {
    const t = new Date();
    setSelectedDate(t);
    setWeekStart(startOfWeek(t, { weekStartsOn: 0 }));
    setScrollToNow(n => n + 1);
  };
  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  // Choosing a day focuses that day. It deliberately does not open the requests
  // column: the panel is opened and closed by the user alone, so reading a day's
  // requests never hangs off a date click. When the column is open it follows the
  // selected day in place.
  const handleSelectDay = useCallback((day) => {
    setSelectedDate(day);
  }, []);

  // Adaptive range navigation
  const goToPrev = () => {
    if (rangeMode === 'week') return goToPrevWeek();
    if (rangeMode === '4days') { const n = subDays(selectedDate, 4); setSelectedDate(n); if (n < weekStart) setWeekStart(subWeeks(weekStart, 1)); return; }
    goToPrevDay();
  };
  const goToNext = () => {
    if (rangeMode === 'week') return goToNextWeek();
    if (rangeMode === '4days') { const n = addDays(selectedDate, 4); setSelectedDate(n); if (n >= addDays(weekStart, 7)) setWeekStart(addWeeks(weekStart, 1)); return; }
    goToNextDay();
  };

  // ── Swipe gestures ────────────────────────────────────────────────────────
  const weekTouchStart = useRef(null);
  const onWeekTouchStart = (e) => { weekTouchStart.current = e.touches[0].clientX; };
  const onWeekTouchEnd = (e) => { if (!weekTouchStart.current) return; const d = weekTouchStart.current - e.changedTouches[0].clientX; if (Math.abs(d) > 40) d > 0 ? goToNextWeek() : goToPrevWeek(); weekTouchStart.current = null; };
  const timelineTouchStart = useRef(null);
  const onTimelineTouchStart = (e) => { timelineTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTimelineTouchEnd = (e) => { if (!timelineTouchStart.current) return; const dx = timelineTouchStart.current.x - e.changedTouches[0].clientX; const dy = Math.abs(timelineTouchStart.current.y - e.changedTouches[0].clientY); if (Math.abs(dx) > 50 && Math.abs(dx) > dy) dx > 0 ? goToNextDay() : goToPrevDay(); timelineTouchStart.current = null; };

  // Requests are placed from the Booking Requests drawer, which offers Edit,
  // Add to Calendar and Decline on every unresolved request — all three go
  // through the backend (shared validator / Route Flow / audit log).

  // ── Update appointment (drag/resize/status) ───────────────────────────────
  // appointmentsRef lets handlers read current appointments without stale closure
  const appointmentsRef = useRef([]);
  useEffect(() => { appointmentsRef.current = appointments; }, [appointments]);
  const handleUpdateAppointment = useCallback(async (apptId, changes, showUndo = false, prevState = null, opts = null) => {
    const appt = appointmentsRef.current.find(a => a.id === apptId);
    if (!appt) return;

    // ── A committed time change is saved by the backend, never here ──────────
    // Drag previews keep passing through the branch below (local render only);
    // a drop, a Schedule Anyway override or a locked/confirmed move is committed
    // through the shared validator, which decides whether the time is allowed.
    if (changes.apptStart !== undefined && opts?.commit === true && appt.requestId) {
      const revert = prevState || {};
      const putBack = () => {
        setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...revert } : a));
        appointmentsRef.current = appointmentsRef.current.map(a => a.id === apptId ? { ...a, ...revert } : a);
        if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, ...revert }));
      };
      // The placement carries whatever day the card was dropped on, so a move to
      // another day (or another week) is validated against that day's schedule.
      const send = (override, overrideTravel, overrideReason) => applyManualPlacement({
        requestId: appt.requestId,
        startDecimal: changes.apptStart,
        date: changes.date || appt.date,
        day: changes.day || undefined,
        barberId: appt.teamMemberId || null,
        expectedUpdatedDate: appt.updatedDate || null,
        override: override === true,
        overrideTravel: overrideTravel === true,
        overrideReason: overrideReason || null,
        note: opts.reason || null,
      });

      // Optimistic: the card lands where it was dropped straight away, so nothing
      // snaps back while the server thinks. Its answer either confirms that time or
      // puts the card back where it was.
      const moveDur = appt.apptEnd - appt.apptStart;
      const moveBuffer = (appt.bufferEnd || appt.apptEnd) - appt.apptEnd;
      const optimistic = {
        apptStart: changes.apptStart,
        apptEnd: changes.apptStart + moveDur,
        bufferEnd: changes.apptStart + moveDur + moveBuffer,
        ...(changes.date ? { date: changes.date, day: changes.day } : {}),
      };
      setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...optimistic } : a));
      appointmentsRef.current = appointmentsRef.current.map(a => a.id === apptId ? { ...a, ...optimistic } : a);
      if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, ...optimistic }));

      // The card says "Saving…" while this one appointment is in flight; the rest of
      // the calendar stays live and editable.
      markSaving(apptId, true);
      let data;
      try {
        data = await send(opts.override, opts.overrideTravel, opts.overrideReason);

        // Preferred availability is a preference, not a lock: when it is the only
        // obstacle the move is simply saved outside it, the booking is marked as
        // awaiting the client's confirmation and the confirmation SMS is queued.
        if (data?.code === 'AVAILABILITY_OVERRIDE_REQUIRED' && data?.can_override === true) {
          data = await send(true, false, 'Placed outside preferred availability — confirmation requested');
        }
      } finally {
        markSaving(apptId, false);
      }

      if (!data || data.saved !== true) {
        putBack();
        // The Booking Window is the one remaining hard setting, so it is asked for
        // explicitly — and nothing is written until the administrator says yes.
        if (data?.code === 'BOOKING_WINDOW_OVERRIDE_REQUIRED' && data?.can_override === true) {
          setWindowOverridePrompt({
            apptId,
            startDecimal: changes.apptStart,
            date: appt.date,
            barberId: appt.teamMemberId || null,
            expectedUpdatedDate: appt.updatedDate || null,
            note: opts.reason || null,
            prevState: revert,
            message: data.message || 'This appointment is outside the booking window.',
          });
          return;
        }
        // Travel that cannot be achieved is the barber's call: the shortfall is put
        // to them with the facts, and "Place Anyway" re-runs this same move as an
        // authorised override, recorded in the audit trail.
        if (data?.code === 'TRAVEL_OVERRIDE_REQUIRED' && data?.can_override === true) {
          const facts = travelWarning(data.result, data.proposed_start_decimal ?? changes.apptStart);
          setTravelPrompt({
            ...facts,
            clientName: appt.clientName,
            timeLabel: data.proposed_start || decimalToLabel(data.proposed_start_decimal ?? changes.apptStart),
            onPlaceAnyway: () => {
              setTravelPrompt(null);
              handleUpdateAppointment(apptId, { apptStart: changes.apptStart }, true, revert, {
                commit: true,
                override: true,
                overrideTravel: true,
                overrideReason: 'Travel time may not be achievable — placed anyway',
              });
            },
          });
          return;
        }
        addToast({
          message: data?.code === 'OVERRIDE_NOT_PERMITTED' ? 'Override not permitted' : 'Could not save that time',
          description: placementRefusalMessage(data) || 'The schedule validator refused this placement.',
          type: 'error',
        });
        return;
      }

      const startDec = data.proposed_start_decimal ?? changes.apptStart;
      const dur = appt.apptEnd - appt.apptStart;
      const bufHrs = (appt.bufferEnd || appt.apptEnd) - appt.apptEnd;
      const awaiting = data.override_status === 'awaiting_confirmation';
      const confirmed = {
        apptStart: startDec,
        apptEnd: startDec + dur,
        bufferEnd: startDec + dur + bufHrs,
        availability_override: awaiting,
        override_status: awaiting ? 'awaiting_confirmation' : 'none',
        schedule_status: data.schedule_status || appt.schedule_status || null,
        updatedDate: data.updated_date || appt.updatedDate || null,
        ...(data.date ? { date: data.date, day: changes.day || appt.day } : {}),
        // What the server actually did about telling the client. Kept apart from the
        // appointment's own scheduling status.
        change_message_queued: data.change_message_queued === true,
      };
      setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...confirmed } : a));
      appointmentsRef.current = appointmentsRef.current.map(a => a.id === apptId ? { ...a, ...confirmed } : a);
      if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, ...confirmed }));
      // A committed move changes the day, so the route state is read back.
      refreshDayRoute();

      // ── What the barber is told, and what the client was actually sent ──────
      // The move already happened. These two facts are kept apart: where the
      // appointment now sits, and whether a change message really left for the client.
      const landedDate = data.date || changes.date || appt.date;
      const dayChanged = !!landedDate && landedDate !== appt.date;
      const moveLabel = dayChanged
        ? `Moved to ${format(new Date(`${landedDate}T00:00:00`), 'EEE d MMM')}`
        : 'Time updated';
      const notifyNote = data.change_message_queued === true
        ? 'The client has been sent the new time.'
        : data.notification_pending === true
          ? 'The client still has the old time — they need the new one. Send it with Confirm Appointments.'
          : null;
      const undoMove = showUndo && prevState ? () => handleUpdateAppointment(
        apptId,
        { apptStart: prevState.apptStart, date: prevState.date, day: prevState.day },
        true,
        {
          apptStart: confirmed.apptStart, apptEnd: confirmed.apptEnd, bufferEnd: confirmed.bufferEnd,
          date: confirmed.date, day: confirmed.day,
        },
        { commit: true },
      ) : undefined;

      // A move across days changes which day the request belongs to, so the day's
      // request list is read back rather than left describing its old date.
      if (dayChanged) loadSchedule({ silent: true });

      if (awaiting) {
        // Saved outside the client's preference: they are being asked to confirm
        // the new time, and the barber is told plainly what is happening.
        setAvailabilityNotice({
          title: 'Placed outside preferred availability',
          detail: `A confirmation SMS is being sent to ${appt.clientName}. The time stays editable until they reply.`,
        });
        addToast({ message: 'Moved — the client is being asked to confirm', type: 'success', onUndo: undoMove });
      } else if (data.travel_override_used === true) {
        addToast({ message: 'Placed anyway — travel override recorded', description: notifyNote || undefined, type: 'success', onUndo: undoMove });
      } else {
        addToast({ message: moveLabel, description: notifyNote || undefined, type: 'success', onUndo: undoMove });
      }
      return;
    }

    // ── Local update: a drag preview or a non-placement change ───────────────
    // No time is ever written to the database here.
    const updatedAppt = { ...appt, ...changes };
    appointmentsRef.current = appointmentsRef.current.map(a => a.id === apptId ? updatedAppt : a);
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...changes } : a));
    if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, ...changes }));

    if (appt.requestId) {
      // Status, override and lock changes are made by the server (permission, audit, side effects).
      // Declined / no-show carry customer messages and counts: they use declineBookingRequest / markNoShow.
      const calls = [];
      if (changes.status !== undefined) {
        const s = apptStatusToDbStatus(changes.status);
        if (s === 'completed') calls.push(['complete', {}]);
        else if (['pending', 'confirmed', 'rescheduled'].includes(s)) calls.push(['set_status', { status: s }]);
      }
      if (changes.availability_override === false && appt.availability_override) calls.push(['clear_override', { reason: 'Moved back inside availability' }]);
      if (changes.override_status === 'confirmed') calls.push(['confirm_override', {}]);
      if (changes.schedule_status === 'locked') calls.push(['lock', {}]);
      if (changes.schedule_status === 'provisional') calls.push(['unlock', {}]);
      for (const [action, extra] of calls) {
        const res = await bookingTransition(action, appt.requestId, extra);
        if (res?.saved !== true) addToast({ message: 'Could not save that change', description: res?.error, type: 'error' });
      }
    }

    if (showUndo && prevState && appt?.requestId) {
      addToast({
        message: 'Updated',
        type: 'success',
        onUndo: () => {
          setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...prevState } : a));
          if (prevState.status !== undefined) {
            bookingTransition('set_status', appt.requestId, { status: apptStatusToDbStatus(prevState.status) });
          }
        },
      });
    }

    if (changes.status === 'window_confirmed') addToast({ message: 'Window confirmed', type: 'success' });
    if (changes.status === 'waiting') addToast({ message: 'Arrival time marked as sent', type: 'success' });
    if (changes.status === 'client_confirmed') addToast({ message: 'Client confirmed ✓', type: 'success' });
    if (changes.status === 'completed') addToast({ message: 'Appointment completed', type: 'success' });
  }, [detailAppt, addToast, markSaving, loadSchedule, refreshDayRoute]);

  // "Schedule Anyway" for the Booking Window — the same commit again, this time
  // sent as an authorised administrator override with its reason.
  const confirmWindowOverride = useCallback(() => {
    const pending = windowOverridePrompt;
    if (!pending) return;
    setWindowOverridePrompt(null);
    handleUpdateAppointment(
      pending.apptId,
      { apptStart: pending.startDecimal },
      false,
      pending.prevState,
      { commit: true, override: true, overrideReason: 'Schedule Anyway — outside booking window' },
    );
  }, [windowOverridePrompt, handleUpdateAppointment]);

  // ── Remove from schedule (returns to requests drawer) ────────────────────
  const handleRemoveAppointment = useCallback(async (apptId) => {
    const appt = appointments.find(a => a.id === apptId);
    if (!appt) return;

    // Blocked time is not a request to hand back: it is deleted outright, so the time
    // is free again and no half-scheduled block is ever left behind.
    if (appt.isBlock) {
      const res = await deleteBlockTime({ booking_request_id: appt.requestId });
      if (res?.saved !== true) {
        addToast({ message: 'Could not remove that block', description: res?.error, type: 'error' });
        return;
      }
      setAppointments(prev => prev.filter(a => a.id !== apptId));
      setDetailAppt(null);
      refreshDayRoute();
      addToast({ message: 'Block removed', description: 'That time is available again.', type: 'success' });
      return;
    }

    // Clearing a time is a backend write too — nothing on this page changes it directly.
    const removed = await unscheduleBooking({ requestId: appt.requestId, resetStatus: true });
    if (removed?.saved !== true) {
      addToast({ message: 'Could not remove from schedule', description: removed?.error || 'Please try again.', type: 'error' });
      return;
    }
    setAppointments(prev => prev.filter(a => a.id !== apptId));
    setAllRequests(prev => prev.map(r => r.id === appt.requestId ? { ...r, status: 'pending', assigned_time: null, schedule_status: 'unscheduled', placement_status: 'unscheduled', placement_reason: 'Removed from the schedule' } : r));
    setDetailAppt(null);
    refreshDayRoute();


    addToast({
      message: 'Removed from schedule',
      description: `${appt.clientName} returned to Requests.`,
      type: 'info',
      // Restoring the time is a fresh placement, so the backend validator decides
      // whether the old slot is still free. Blocked time has nothing to re-validate.
      onUndo: appt.isBlock ? undefined : async () => {
        const back = await applyManualPlacement({
          requestId: appt.requestId,
          startDecimal: appt.apptStart,
          date: appt.date,
          barberId: appt.teamMemberId || null,
          confirmRequest: true,
          note: 'Undo remove from schedule',
        });
        if (!back || back.saved !== true) {
          addToast({
            message: 'Could not restore that time',
            description: placementRefusalMessage(back) || 'The schedule validator refused this placement.',
            type: 'error',
          });
          return;
        }
        setAppointments(prev => [...prev, { ...appt, schedule_status: back.schedule_status || appt.schedule_status, updatedDate: back.updated_date || null }]);
        setAllRequests(prev => prev.map(r => r.id === appt.requestId ? { ...r, status: 'confirmed', assigned_time: back.assigned_time, schedule_status: back.schedule_status || 'provisional', updated_date: back.updated_date || r.updated_date } : r));
      },
    });
  }, [appointments, addToast]);

  // ── Confirm window ────────────────────────────────────────────────────────
  const handleConfirmWindow = useCallback(async (apptId) => {
    const appt = appointments.find(a => a.id === apptId);
    if (!appt) return;
    try {
      await base44.functions.invoke('confirmBooking', { booking_request_id: appt.requestId });
    } catch (e) {
      addToast({ message: 'Could not confirm booking', description: e?.response?.data?.error || e?.message, type: 'error' });
      return;
    }
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: 'window_confirmed' } : a));
    if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, status: 'window_confirmed' }));
    addToast({ message: 'Window confirmed', type: 'success' });
  }, [appointments, detailAppt, addToast]);

  // ── Send arrival time ─────────────────────────────────────────────────────
  const handleSendTime = useCallback((apptId) => {
    // Nothing is sent or changed here. Arrival times are queued by the evening
    // arrival job once the day's route is finalised, so this must not claim a send
    // or write a booking status.
    addToast({ message: 'Arrival times are sent automatically the evening before, once the route is finalised', type: 'info' });
  }, [addToast]);

  const openDetail = useCallback((appt) => setDetailAppt(appt), []);

  // ── Create modal handlers ─────────────────────────────────────────────────
  // Creating an appointment writes real bookings on the server — and, for an exact
  // time, places them through the shared validator — so the calendar is read back
  // rather than patched: what is on screen is always what is stored.
  const handleBookingSaved = useCallback((result) => {
    setActiveModal(null);
    setPrefillTime(null);
    setPrefillMins(null);
    loadSchedule({ silent: true });
    refreshDayRoute();
    const total = result?.total || 1;
    if (result?.mode === 'window') {
      addToast({
        message: total > 1 ? `${total} appointments saved` : 'Appointment saved',
        description: 'Route Flow will place it inside the availability window.',
        type: 'success',
      });
    } else if (result?.unplaced > 0) {
      addToast({
        message: `${result.placed} of ${total} placed`,
        description: result.refusal || 'The rest are waiting for a slot in Bookings.',
        type: result.placed > 0 ? 'info' : 'error',
      });
    } else {
      addToast({
        message: total > 1 ? `${total} appointments created` : 'Appointment added to the calendar',
        type: 'success',
      });
    }
  }, [loadSchedule, refreshDayRoute, addToast]);

  // Click, or click and drag, on the calendar: the form opens at that time. A dragged
  // range rides along as a preview only — the service is what sets the real length.
  const handleEmptyRange = useCallback((dayName, timeDecimal, endDecimal = null) => {
    if (timeDecimal == null) return;
    const dayIdx = weekDays.findIndex(d => format(d, 'EEEE') === dayName);
    if (dayIdx >= 0) setSelectedDate(weekDays[dayIdx]);
    setPrefillTime(timeDecimal);
    setPrefillMins(endDecimal != null ? Math.round((endDecimal - timeDecimal) * 60) : null);
    setCreateMenuOpen(true);
  }, [weekDays]);

  const handleEmptyHold = useCallback((timeDecimal) => {
    handleEmptyRange(selectedDayName, timeDecimal, null);
  }, [handleEmptyRange, selectedDayName]);

  const handleDayRange = useCallback((startDecimal, endDecimal) => {
    handleEmptyRange(selectedDayName, startDecimal, endDecimal);
  }, [handleEmptyRange, selectedDayName]);

  const handleClientSaved = useCallback((req) => {
    setAllRequests(prev => [req, ...prev]);
    setActiveModal(null);
    addToast({ message: `${req.client_name} saved`, type: 'success' });
  }, [addToast]);

  // A block (or a whole repeating series) was written: the day is read back, never patched.
  const handleBlockSaved = useCallback((res) => {
    setActiveModal(null);
    setPrefillTime(null);
    setPrefillMins(null);
    loadSchedule({ silent: true });
    refreshDayRoute();
    const count = Number(res?.count) || 1;
    addToast({
      message: count > 1 ? `${count} blocks created` : 'Time blocked',
      description: count > 1 ? 'Each one can be changed or removed on its own, or as a series.' : undefined,
      type: 'success',
    });
  }, [loadSchedule, refreshDayRoute, addToast]);

  // ── Blocked time: look at it, change it, move it, take it away ────────────
  // The block workflow lives in its own hook, so the grids stay presentation only.
  const {
    blockEdit, blockDelete,
    openEdit: handleOpenBlockEdit,
    openDelete: handleOpenBlockDelete,
    closeDialogs: closeBlockDialogs,
    changed: handleBlockChanged,
    commit: handleBlockCommit,
  } = useBlockActions({ loadSchedule, refreshDayRoute, addToast });

  // ── Completion: update appointment + client + workflow ─────────────────
  const handleComplete = useCallback(async (apptId) => {
    const appt = appointmentsRef.current.find(a => a.id === apptId);
    if (!appt) return;
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: 'completed' } : a));
    if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, status: 'completed' }));
    // The same completion the Route tab runs: status, client stamp, next reminder, completion text, balance.
    if (appt.requestId) {
      const res = await bookingTransition('complete', appt.requestId);
      if (res?.saved !== true) {
        setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: appt.status } : a));
        if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, status: appt.status }));
        addToast({ message: 'Could not complete the appointment', description: res?.error, type: 'error' });
        return;
      }
    }
    addToast({ message: 'Appointment completed ✓', type: 'success' });
  }, [detailAppt, addToast]);

  // ── Cancel ─────────────────────────────────────────────────────────────
  const handleCancelAppt = useCallback(async (apptId, deposit = {}) => {
    const appt = appointmentsRef.current.find(a => a.id === apptId);
    if (!appt) return;
    // Cancelling goes through the server decline path, which also queues the customer message. When the
    // booking holds money the answer to "what happens to the deposit?" rides along, and a refusal (for
    // example a refund Square declined) leaves the appointment as it was.
    if (appt.requestId) {
      const res = await declineBookingRequest({ booking_request_id: appt.requestId, reason: 'Customer cancelled', ...deposit });
      if (res?.saved !== true) {
        addToast({ message: 'Could not cancel the appointment', description: res?.error, type: 'error' });
        return;
      }
    }
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: 'cancelled' } : a));
    if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, status: 'cancelled' }));
    addToast({ message: 'Appointment cancelled', type: 'info' });
  }, [detailAppt, addToast]);

  // ── No-show ────────────────────────────────────────────────────────────
  const handleNoShow = useCallback(async (apptId) => {
    const appt = appointmentsRef.current.find(a => a.id === apptId);
    if (!appt) return;
    // The server records the no-show, the client's count and the follow-up message.
    if (appt.requestId) {
      try {
        await base44.functions.invoke('markNoShow', { booking_request_id: appt.requestId });
      } catch (e) {
        addToast({ message: 'Could not mark as no-show', description: e?.response?.data?.error || e?.message, type: 'error' });
        return;
      }
    }
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: 'no_show' } : a));
    if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, status: 'no_show' }));
    addToast({ message: 'Marked as no-show', type: 'info' });
  }, [detailAppt, addToast]);

  // Adding an existing request to the calendar now happens in the Booking Requests
  // panel and by dragging it onto the grid — never from the create-appointment form.

  // ── Set schedule status (provisional / locked / confirmed) ──────────────────
  // Persisted to DB. Locked and confirmed appointments are never moved by
  // Auto Sort. Manual movement of confirmed appointments requires an override.
  const handleSetScheduleStatus = useCallback(async (apptId, newStatus) => {
    const appt = appointmentsRef.current.find(a => a.id === apptId);
    // Confirming is a server-side transition (status, who confirmed, customer message).
    if (newStatus === 'confirmed' && appt?.requestId) {
      try {
        await base44.functions.invoke('confirmBooking', { booking_request_id: appt.requestId, confirm_time: true });
      } catch (e) {
        addToast({ message: 'Could not confirm booking', description: e?.response?.data?.error || e?.message, type: 'error' });
        return;
      }
    }
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, schedule_status: newStatus } : a));
    if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, schedule_status: newStatus }));
    if (appt?.requestId && newStatus !== 'confirmed') {
      const res = await bookingTransition(newStatus === 'locked' ? 'lock' : 'unlock', appt.requestId);
      if (res?.saved !== true) {
        addToast({ message: 'Could not change the lock', description: res?.error, type: 'error' });
        return;
      }
    }
    const labels = { provisional: 'Unlocked — provisional', locked: 'Time locked', confirmed: 'Time confirmed' };
    addToast({ message: labels[newStatus] || newStatus, type: 'success' });
  }, [detailAppt, addToast, currentUserName]);

  // ── Mark an availability override as client-confirmed ──────────────────────
  const handleConfirmOverride = useCallback((apptId) => {
    const appt = appointmentsRef.current.find(a => a.id === apptId);
    if (!appt) return;
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, override_status: 'confirmed' } : a));
    if (detailAppt?.id === apptId) setDetailAppt(prev => ({ ...prev, override_status: 'confirmed' }));
    if (appt.requestId) {
      bookingTransition('confirm_override', appt.requestId, { reason: 'Client agreed to the time outside their availability' }).then((res) => {
        if (res?.saved !== true) addToast({ message: 'Could not record the confirmation', description: res?.error, type: 'error' });
      });
    }
    addToast({ message: 'Client confirmed ✓', type: 'success' });
  }, [detailAppt, addToast]);

  // ── Favourite: one-click client preference ───────────────────────────────
  // A scheduling preference only — it never protects a booking. The client
  // record is the single source of truth, so every appointment for that client
  // (and the Clients page) reflects the change.
  const handleToggleFavourite = useCallback(async (appt) => {
    const sig = signals.lookup(appt.clientName);
    try {
      // A booking may not have a client record yet (e.g. a request added straight
      // to the calendar). Favouriting creates it, so the flag has one home.
      if (!sig?.clientId) {
        // The server decides is_test: from the booking this favourite came from, and the name.
        const { created: [created] } = await createAdminClients([{
          client_name: appt.clientName,
          phone: appt.phone || '',
          email: appt.email || '',
          address: appt.address || '',
          frequency: 'Monthly',
          cadence_source: 'default',
          source: 'Existing booking',
          is_favourite: true,
          from_booking_id: appt.requestId || undefined,
        }]);
        setClients(prev => [created, ...prev]);
        addToast({ message: 'Added to Favourites', type: 'success' });
        return;
      }
      const next = sig.isFavourite !== true;
      setClients(prev => prev.map(c => c.id === sig.clientId ? { ...c, is_favourite: next } : c));
      await base44.entities.ReminderClient.update(sig.clientId, { is_favourite: next });
      addToast({ message: next ? 'Added to Favourites' : 'Removed from Favourites', type: 'success' });
    } catch {
      if (sig?.clientId) {
        setClients(prev => prev.map(c => c.id === sig.clientId ? { ...c, is_favourite: sig.isFavourite === true } : c));
      }
      addToast({ message: 'Could not update favourite', type: 'error' });
    }
  }, [signals, addToast]);

  const handleConnectDay = useConnectAppointments({
    date: selectedDateKey, staffId: selectedStaffId,
    busy: routeBusy, confirming: confirmBusy, saving: savingIds.size > 0,
    setBusy: setRouteBusy, reload: loadSchedule, refreshRoute: refreshDayRoute, notify: addToast,
  });

  const handleDisconnectDay = useCallback(async () => {
    setRouteBusy(true);
    const res = await disconnectDayRoute({ date: selectedDateKey, teamMemberId: selectedStaffId });
    setRouteBusy(false);
    if (!res?.ok) {
      addToast({ message: 'Could not disconnect the day', description: res?.message, type: 'error' });
      return;
    }
    refreshDayRoute();
    loadSchedule({ silent: true });
    addToast({
      message: 'Day disconnected',
      description: 'The drive legs are gone — the day is a draft again.',
      type: 'info',
    });
  }, [selectedDateKey, selectedStaffId, refreshDayRoute, loadSchedule, addToast]);

  const handleConfirmDay = useCallback(async () => {
    // An impossible schedule is never confirmed: the overlap is named instead.
    if (dayConflicts.length > 0) {
      setConfirmOpen(false);
      addToast({
        message: 'This day has overlapping appointments',
        description: `${conflictSummary(dayConflicts[0])}. Move one of them, then confirm.`,
        type: 'error',
      });
      return;
    }
    const ids = routeAppointments.filter(a => a.requestId && a.status !== 'cancelled').map(a => a.requestId);
    setConfirmBusy(true);
    const { confirmed, failed, firstError } = await confirmDayAppointments(ids);
    await Promise.all([loadSchedule({ silent: true }), refreshDayRoute()]);
    setConfirmBusy(false);
    setConfirmOpen(false);
    if (failed === 0) {
      addToast({
        message: `${confirmed} appointment${confirmed === 1 ? '' : 's'} confirmed`,
        description: 'Confirmation messages have been queued; delivery status is shown in Messages.',
        type: 'success',
      });
    } else {
      addToast({
        message: `${confirmed} confirmed, ${failed} could not be`,
        description: firstError || 'The others are still unconfirmed — try again.',
        type: 'error',
      });
    }
  }, [routeAppointments, dayConflicts, loadSchedule, refreshDayRoute, addToast]);

  return (
    <div className="flex flex-col h-screen bg-zinc-50">
      <ScheduleToastContainer toasts={toasts} onDismiss={dismissToast} />

      <CalendarToolbar
        rangeMode={rangeMode}
        selectedDate={selectedDate}
        displayDays={displayDays}
        onToday={goToToday}
        onPrev={goToPrev}
        onNext={goToNext}
        staffMembers={staffMembers}
        selectedStaffId={selectedStaffId}
        onSelectStaff={setSelectedStaffId}
        onSelectRange={setRangeMode}
        onCreate={() => setCreateMenuOpen(true)}
        onConnect={handleConnectDay}
        canConnect={routeAppointments.length >= 2 && !confirmBusy && savingIds.size === 0}
        connecting={routeBusy}
        routeStatus={routeBusy ? 'finalising' : (dayRoute?.status || 'draft')}
        confirmed={allTimesConfirmed}
      />

      {/* What just happened: a placement outside the client's preference is saved,
          and they are being asked to confirm it. */}
      <AvailabilityNotice notice={availabilityNotice} onDismiss={() => setAvailabilityNotice(null)} />

      {/* How this calendar behaves, stated once. */}
      <ManualSchedulingHint />

      {/* An impossible day is said out loud on the calendar too, not only on Route. */}
      <RouteConflictBanner conflicts={dayConflicts} className="mt-2" />

      {/* ── The workspace: the week, and beside it the requests waiting for the chosen day ── */}
      <div className="flex min-h-0 flex-1">
      <div className="flex-1 min-w-0 overflow-hidden relative bg-white" onTouchStart={onTimelineTouchStart} onTouchEnd={onTimelineTouchEnd}>
        {/* The connected day's route, at a glance — and the two things it can do next. */}
        <RouteSummaryCard
          state={dayRoute}
          busy={routeBusy}
          dateLabel={format(selectedDate, 'EEEE d MMMM')}
          appointments={routeAppointments.length}
          allConfirmed={allTimesConfirmed}
          confirming={confirmBusy}
          onDisconnect={handleDisconnectDay}
          onConfirm={() => setConfirmOpen(true)}
          onViewRoute={() => navigate('/admin/route')}
        />

        {loadError && !hasLoaded ? (
          <div className="flex items-center justify-center h-full">
            <ErrorState
              title="Couldn't load the calendar"
              description="Please try again."
              onRetry={loadSchedule}
            />
          </div>
        ) : !hasLoaded ? (
          <CalendarSkeleton />
        ) : rangeMode === 'day' ? (
          <DayTimeline
            day={selectedDayName}
            appointments={dayAppts}
            businessHours={businessHours}
            onOpenDetail={openDetail}
            onUpdateAppointment={handleUpdateAppointment}
            onRemove={handleRemoveAppointment}
            onEmptyHold={handleEmptyHold}
            onEmptyRange={handleDayRange}
            onToggleFavourite={handleToggleFavourite}
            legs={calendarLegs}
            onSetScheduleStatus={handleSetScheduleStatus}
            onEditBlock={handleOpenBlockEdit}
            onDeleteBlock={handleOpenBlockDelete}
            onBlockCommit={handleBlockCommit}
            isToday={isToday}
            scrollToNowSignal={scrollToNow}
            savingIds={savingIds}
          />
        ) : (
          <WeekGrid
            days={displayDays}
            appointments={decoratedAppointments}
            businessHours={businessHours}
            onOpenDetail={openDetail}
            onEmptyClick={handleEmptyRange}
            onEmptyRange={handleEmptyRange}
            onUpdateAppointment={handleUpdateAppointment}
            lockedIds={lockedIds}
            protectionSettings={protectionSettings}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDay}
            onPlacementHover={applyHover}
            placement={placement}
            selectedApptId={detailAppt?.id || null}
            legs={calendarLegs}
            onToggleFavourite={handleToggleFavourite}
            onSetScheduleStatus={handleSetScheduleStatus}
            onEditBlock={handleOpenBlockEdit}
            onDeleteBlock={handleOpenBlockDelete}
            onBlockCommit={handleBlockCommit}
            scrollToNowSignal={scrollToNow}
            savingIds={savingIds}
          />
        )}
      </div>

        {/* ── The selected day's booking requests, a column of this workspace ── */}
        <RequestsDrawer
          open={requestsOpen}
          onClose={closePanel}
          requests={openRequests}
          dayLabel={openRequestsDayLabel}
          loading={loading}
          initialFilter={drawerFilter}
          onChanged={() => loadSchedule({ silent: true })}
          onBeginPlacement={canDragRequests ? beginPlacement : undefined}
          draggingId={placement?.request?.id || null}
          busyId={placeBusyId}
        />

        {/* Collapsed, the column is a thin tab on the far-right edge of the workspace
            — always visible, and the only thing that opens the panel. */}
        {!requestsOpen && (
          <RequestsTab count={openRequests.length} onOpen={openPanel} />
        )}
      </div>

      {/* ── Appointment Detail Side Panel ── */}
      {detailApptView && (
        <AppointmentDetailPanel
          appt={detailApptView}
          onClose={() => setDetailAppt(null)}
          onComplete={handleComplete}
          onCancel={handleCancelAppt}
          onNoShow={handleNoShow}
          onRemove={handleRemoveAppointment}
          onUpdate={handleUpdateAppointment}
          onAddToast={addToast}
          onSetScheduleStatus={handleSetScheduleStatus}
          onConfirmOverride={handleConfirmOverride}
          onToggleFavourite={handleToggleFavourite}
          // The drawer's Edit Booking writes through the backend, so the day is read
          // back rather than patched: what is on screen is always what is stored.
          onBookingSaved={() => { loadSchedule({ silent: true }); refreshDayRoute(); }}
        />
      )}

      {/* Connect saves the planning times directly; only Confirm messages clients. */}
      <ConfirmAppointmentsDialog
        open={confirmOpen}
        dateLabel={format(selectedDate, 'EEEE d MMMM')}
        count={routeAppointments.filter(a => a.status !== 'cancelled').length}
        busy={confirmBusy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmDay}
      />

      {/* ── The drag, the decisions it may need, and the create modals ── */}
      <CalendarOverlays
        // Two ways a Booking Window override can be asked for: moving an existing
        // appointment, or dragging a request out of the requests column. Both need
        // the same explicit yes, so both are shown by the same prompt.
        windowPrompt={windowOverridePrompt
          || (overridePrompt?.kind === 'window' ? { message: overridePrompt.message } : null)}
        onCancelWindowOverride={() => { setWindowOverridePrompt(null); cancelOverride(); }}
        onConfirmWindowOverride={() => {
          if (windowOverridePrompt) confirmWindowOverride();
          else confirmOverride();
        }}
        travelPrompt={travelPrompt}
        travelBusy={travelBusy}
        onCancelTravel={() => setTravelPrompt(null)}
        onConfirmTravel={() => travelPrompt?.onPlaceAnyway?.()}
        placement={placement}
        ghost={ghost}
        createMenuOpen={createMenuOpen}
        onCloseCreateMenu={() => setCreateMenuOpen(false)}
        onSelectCreate={(key) => { setActiveModal(key); setCreateMenuOpen(false); }}
        activeModal={activeModal}
        selectedDay={selectedDayName}
        selectedDateKey={selectedDateKey}
        prefillTime={prefillTime}
        prefillMinutes={prefillMins}
        businessHours={businessHours}
        staffMembers={staffMembers}
        defaultStaffId={selectedStaffId}
        onCloseModal={() => { setActiveModal(null); setPrefillTime(null); setPrefillMins(null); }}
        onBookingSaved={handleBookingSaved}
        onBlockSaved={handleBlockSaved}
        blockEdit={blockEdit}
        blockDelete={blockDelete}
        onCloseBlockEdit={closeBlockDialogs}
        onBlockChanged={handleBlockChanged}
      />
    </div>
  );
}

// ── Shared utils ──────────────────────────────────────────────────────────────
export { decimalToLabel, snapDecimal };

export function parseWindow(str) {
  if (!str || str === 'Flexible') return null;
  const clean = str.replace(/\s/g, '').toLowerCase();
  const match = clean.match(/^(.+?)[–\-](.+)$/);
  if (!match) return null;
  const s = parseTimeStr(match[1]);
  const e = parseTimeStr(match[2]);
  if (isNaN(s) || isNaN(e)) return null;
  return { start: s, end: e };
}

export function parseTimeStr(s) {
  s = s.toLowerCase().replace(/\s/g, '');
  const isPm = s.endsWith('pm');
  const isAm = s.endsWith('am');
  s = s.replace('am', '').replace('pm', '');
  let [h, m] = s.includes(':') ? s.split(':').map(Number) : [Number(s), 0];
  if (isNaN(h)) return NaN;
  if (isPm && h !== 12) h += 12;
  if (isAm && h === 12) h = 0;
  return h + (m || 0) / 60;
}