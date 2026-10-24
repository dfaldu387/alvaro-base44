import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { format, addDays, subDays, isToday, isBefore, startOfDay } from 'date-fns';
import { calculateDriveTimes } from '@/lib/driveTimeService';
import { decimalToLabel } from '@/lib/timeUtils';
import { reqToAppt, isPlacedOnCalendar } from '@/lib/appointmentUtils';
import { loadTimingCatalogue, bufferMinutesFor } from '@/lib/appointmentTiming';
import { buildTimeline, calcBreakdown } from '@/lib/routeTimeline';
import TimelineBlock from '@/components/route/TimelineBlock';
import RouteStatusBar from '@/components/route/RouteStatusBar';
import RouteStartBlock from '@/components/route/RouteStartBlock';
import { dateKey } from '@/lib/dateScope';
import { loadDayRouteState, finishDayRoute } from '@/lib/dayRouteStatus';
import { Link } from 'react-router-dom';
import CurrentStopPanel from '@/components/route/CurrentStopPanel';
import RouteEtaLine from '@/components/route/RouteEtaLine';
import StopPayment from '@/components/route/StopPayment';
import RouteConflictBanner from '@/components/route/RouteConflictBanner';
import RouteMap from '@/components/route/RouteMap';
import StopDetailsPanel from '@/components/route/StopDetailsPanel';
import StopEditDialog from '@/components/route/StopEditDialog';
import StopRescheduleDialog from '@/components/route/StopRescheduleDialog';
import StopCancelDialog from '@/components/route/StopCancelDialog';
import { declineBookingRequest } from '@/lib/requestAdmin';
import { findDayConflicts } from '@/lib/scheduleConflicts';
import StopCheckout from '@/components/route/execution/StopCheckout';
import useRouteEta, { lateByRequest } from '@/hooks/useRouteEta';
import useLiveLocation from '@/hooks/useLiveLocation';
import LiveLocationToggle from '@/components/route/LiveLocationToggle';
import { loadRouteStops, advanceStop } from '@/lib/routeStops';
import {
  MapPin, Clock, DollarSign,
  ChevronRight, ChevronLeft,
  CalendarDays, ChevronDown
} from 'lucide-react';

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// Which appointments are stops on the day's route.
//
// An appointment loaded from the database carries a CALENDAR status (reqToAppt -> mapDbStatus):
// draft, scheduled, completed, blocked, rescheduled, no_show, cancelled. The route-only values
// below it — planned, window_confirmed, waiting, client_confirmed — are set in-session by the
// Calendar and never survive a reload. Listing only those meant the one overlapping value was
// 'completed', so the Route tab showed finished work and nothing else: an upcoming day read as
// "No clients on this day". The day ahead is the whole point of this screen, so draft and
// scheduled belong here. Cancelled, declined, no-show and blocks are not stops.
const ROUTE_STATUSES = ['draft','scheduled','planned','window_confirmed','waiting','client_confirmed','completed'];

function fmtMins(mins) {
  if (!mins || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function routeTitle(date) {
  if (isToday(date)) return "Today's Route";
  const tomorrow = addDays(startOfDay(new Date()), 1);
  if (format(date,'yyyy-MM-dd') === format(tomorrow,'yyyy-MM-dd')) return "Tomorrow's Route";
  const yesterday = subDays(startOfDay(new Date()), 1);
  if (format(date,'yyyy-MM-dd') === format(yesterday,'yyyy-MM-dd')) return "Yesterday's Route";
  return format(date,'EEEE') + "'s Route";
}

function leaveByLabel(stop, driveInfo) {
  const driveMins = driveInfo?.state === 'ok' ? driveInfo.mins : 15;
  return decimalToLabel(stop.apptEnd - driveMins / 60);
}

export default function AdminRoute() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allAppointments, setAllAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drivingTimes, setDrivingTimes] = useState({});
  // The day's route state, and the drive legs a finalised route stored.
  const [dayRoute, setDayRoute] = useState(null);
  const [storedLegs, setStoredLegs] = useState({});
  const [routeBusy, setRouteBusy] = useState(false);
  const [completedIds, setCompletedIds] = useState(new Set());
  // Stored progress per booking (arrived, in service, completed, skipped…), read from the server.
  const [executions, setExecutions] = useState({});
  const [execError, setExecError] = useState(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(true);
  const [checkoutStop, setCheckoutStop] = useState(null);
  // One appointment card is open at a time, and only one — opening another closes it.
  const [expandedId, setExpandedId] = useState(null);
  const [editStop, setEditStop] = useState(null);
  const [rescheduleStop, setRescheduleStop] = useState(null);
  const [cancelStop, setCancelStop] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [stopError, setStopError] = useState(null); // { stopId, message }
  const [routeError, setRouteError] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  // The barber's saved start location, and the stop picked on the map.
  const [staffMembers, setStaffMembers] = useState([]);
  const [mapStopId, setMapStopId] = useState(null);
  const calculatingRef = useRef(false);
  const currentCardRef = useRef(null);

  const selectedDateKey = dateKey(selectedDate);
  const { routes: etaRoutes, refresh: refreshEta } = useRouteEta(selectedDateKey);
  const lateMap = useMemo(() => lateByRequest(etaRoutes), [etaRoutes]);
  const isViewingToday = isToday(selectedDate);
  const isPast = isBefore(startOfDay(selectedDate), startOfDay(new Date()));

  // Load all appointments (re-read after a route is rebuilt, so times follow)
  const loadAppointments = useCallback(() => {
    // Route efficiency analytics exclude test activity.
    return Promise.all([
      // Every booking placed on the day, test stops included: the Calendar shows them,
      // so the Route tab must show the same day. Test stops are labelled and left out of
      // the money figures — they are never "not on the route".
      base44.entities.BookingRequest.list('-created_date', 500),
      // The live catalogue resolves each appointment's CONFIGURED buffer — the
      // same occupancy the backend validator enforces.
      loadTimingCatalogue(base44),
    ])
      .then(([reqs, catalogue]) => {
        const appts = reqs
          // The same rule the Calendar uses. Reading only `status` missed a provisionally placed
          // booking (status 'pending', schedule_status 'provisional'), so a day the Calendar showed
          // as full — and that Connect Appointments counted — arrived here as "No clients on this day".
          .filter(r => isPlacedOnCalendar(r) && !r.client_name?.startsWith('[BLOCK]'))
          .map(r => reqToAppt(r, bufferMinutesFor(r, catalogue))).filter(Boolean);
        setAllAppointments(appts);
        setCatalogue(catalogue);
        setCompletedIds(new Set(appts.filter(a => a.status === 'completed').map(a => a.id)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAppointments().finally(() => setLoading(false));
  }, [loadAppointments]);

  // Where the day actually starts: the barber's own start location.
  useEffect(() => {
    base44.entities.TeamMember.list('-created_date', 50)
      .then(rows => setStaffMembers(rows || []))
      .catch(() => {});
  }, []);

  // A stop picked on one day is not a stop on the next.
  useEffect(() => { setMapStopId(null); setExpandedId(null); }, [selectedDateKey]);

  // ── The day's route, and the drive legs the finalised route stored ────────
  // A finalised route is a real record: the Route tab reads its legs rather than
  // estimating them again, so travel is counted exactly once.
  const refreshDayRoute = useCallback(() => {
    let cancelled = false;
    Promise.all([
      loadDayRouteState(selectedDateKey),
      base44.entities.RouteConnection.filter({ date: selectedDateKey }, '-created_date', 100).catch(() => []),
    ]).then(([state, legs]) => {
      if (cancelled) return;
      setDayRoute(state || null);
      const mapped = {};
      const rows = Array.isArray(legs) ? legs : (legs?.items || []);
      for (const leg of rows) {
        if (leg.status === 'stale') continue;
        mapped[`${leg.from_appointment_id}_${leg.to_appointment_id}`] = {
          state: 'ok',
          mins: leg.duration_minutes ?? null,
          km: leg.distance_km ?? null,
        };
      }
      setStoredLegs(mapped);
    });
    return () => { cancelled = true; };
  }, [selectedDateKey]);

  useEffect(() => { refreshDayRoute(); }, [refreshDayRoute]);

  // Progress lives on the server: reload it on open, on date change, and when this
  // tab comes back to the front, so a second device always shows the same thing.
  const reloadExecutions = useCallback(() => loadRouteStops(selectedDateKey).then(setExecutions).catch(() => {}), [selectedDateKey]);
  useEffect(() => {
    reloadExecutions();
    const onShow = () => { if (document.visibilityState === 'visible') reloadExecutions(); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [reloadExecutions]);

  // Reconnect Appointments — the same press as the Calendar's Connect Appointments:
  // it rebuilds the day's times and driving once the day has changed.
  const handleReconnect = useCallback(async () => {
    setRouteBusy(true);
    setRouteError(null);
    try {
      const result = await finishDayRoute({ date: selectedDateKey });
      if (result?.ok) {
        await loadAppointments();
        refreshDayRoute();
      } else {
        setRouteError(result?.message || 'The route could not be reconnected.');
      }
    } finally {
      setRouteBusy(false);
    }
  }, [selectedDateKey, loadAppointments, refreshDayRoute]);

  // Stops are the exact date's route in execution order. A route finalised for
  // one Friday is never rendered on another Friday.
  const stops = useMemo(() =>
    allAppointments
      .filter(a => a.date === selectedDateKey && ROUTE_STATUSES.includes(a.status))
      .sort((a, b) => a.apptStart - b.apptStart),
    [allAppointments, selectedDateKey]
  );

  // The map starts at the barber's saved start location: the first leg of the day
  // is part of the route, not a detail. Without one, the stored route's start
  // address is used; with neither, the route begins at the first stop.
  const mapStart = useMemo(() => {
    const barberIds = [...new Set(stops.map(s => s.teamMemberId).filter(Boolean))];
    const withStart = staffMembers.filter(m => m.start_location_lat != null && m.start_location_lng != null);
    const chosen = withStart.find(m => barberIds.includes(m.id)) || withStart[0] || null;
    if (chosen) {
      return { lat: chosen.start_location_lat, lng: chosen.start_location_lng, address: chosen.start_location_address || '' };
    }
    if (dayRoute?.start_location_address) return { lat: null, lng: null, address: dayRoute.start_location_address };
    return null;
  }, [stops, staffMembers, dayRoute]);

  // Current appointment index (today only)
  // Done = the booking is completed, or the server says the stop was completed.
  const completedSet = useMemo(() => {
    const s = new Set(completedIds);
    stops.forEach(st => { if (executions[st.requestId]?.state === 'completed') s.add(st.id); });
    return s;
  }, [completedIds, stops, executions]);
  const skippedSet = useMemo(() => new Set(stops.filter(st => executions[st.requestId]?.state === 'skipped').map(st => st.id)), [stops, executions]);

  const currentIdx = useMemo(() => {
    if (!isViewingToday) return -1;
    return stops.findIndex(s => !completedSet.has(s.id) && !skippedSet.has(s.id));
  }, [stops, completedSet, skippedSet, isViewingToday]);

  const completedCount = useMemo(() => stops.filter(s => completedSet.has(s.id)).length, [stops, completedSet]);
  const totalStops = stops.length;
  const progressPct = totalStops > 0 ? (completedCount / totalStops) * 100 : 0;

  // Full-day timeline blocks
  const timeline = useMemo(() => buildTimeline(stops, drivingTimes), [stops, drivingTimes]);

  // Metrics
  const metrics = useMemo(() => {
    // Test stops are QA, never earnings.
    const revenue = stops.filter(s => !s.is_test).reduce((s, a) => s + (a.price || 0), 0);
    const firstStart = stops[0]?.apptStart || 0;
    const lastEnd = stops[stops.length-1]?.bufferEnd || stops[stops.length-1]?.apptEnd || 0;
    const totalMins = lastEnd > firstStart ? (lastEnd - firstStart) * 60 : 0;
    const revenuePerHour = totalMins > 0 ? revenue / (totalMins / 60) : 0;
    return { revenue, totalMins, revenuePerHour };
  }, [stops]);

  // Time breakdown
  const breakdown = useMemo(() => calcBreakdown(timeline, drivingTimes), [timeline, drivingTimes]);

  // Appointments the barber physically cannot serve: same day, same barber, overlapping
  // service time. Stated on the page, and the same rule refuses a confirmation.
  const conflicts = useMemo(() => findDayConflicts(stops), [stops]);
  const provisionalCount = useMemo(() => stops.filter(s => s.schedule_status !== 'confirmed').length, [stops]);

  // Drive time calculation
  const runCalculation = useCallback(async (stopsToCalc) => {
    if (stopsToCalc.length < 2 || calculatingRef.current) return;
    calculatingRef.current = true;
    await calculateDriveTimes(stopsToCalc, partial => setDrivingTimes(prev => ({ ...prev, ...partial })));
    calculatingRef.current = false;
  }, []);

  // ── Drive legs: the finalised route's own legs, or an estimate while drafting ──
  const finalised = dayRoute?.status === 'finalised';
  const stopsKey = stops.map(s => `${s.id}:${s.address}`).join('|');
  const storedLegsKey = Object.keys(storedLegs).sort().join(',');
  useEffect(() => {
    if (finalised && storedLegsKey) {
      // The day was finalised, so its stored drive legs are the record of it.
      setDrivingTimes(storedLegs);
      return;
    }
    if (stops.length >= 2) { calculatingRef.current = false; runCalculation(stops); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, finalised, storedLegsKey]);

  // Actions
  // Every step (on my way, arrived, start, complete, skip) is saved by the server.
  // Nothing changes on screen until the server confirms it; on a conflict the day is
  // reloaded so the barber sees what the other screen did.
  const handleAdvance = useCallback(async (stop, action, reason) => {
    setExecError(null);
    setStepBusy(true);
    const res = await advanceStop({
      requestId: stop.requestId, action, reason,
      expectedUpdatedDate: executions[stop.requestId]?.updatedDate,
    });
    setStepBusy(false);
    if (!res.ok) {
      setExecError(res.message);
      reloadExecutions();
      return false;
    }
    await reloadExecutions();
    refreshEta();
    if (action === 'skip') refreshDayRoute();
    if (action === 'complete') {
      loadAppointments();
      setTimeout(() => currentCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }
    return true;
  }, [executions, reloadExecutions, refreshEta, refreshDayRoute, loadAppointments]);

  // ── Everything an opened card can do ──────────────────────────────────────
  // Each action goes to the endpoint that already owns its rules; the day is then
  // re-read, so the timeline and the stored route always describe the same day.
  const reloadStopData = useCallback(async () => {
    await Promise.all([loadAppointments(), reloadExecutions()]);
    refreshEta();
    refreshDayRoute();
  }, [loadAppointments, reloadExecutions, refreshEta, refreshDayRoute]);

  // A saved edit (details or time) can change the day, so the route is re-read:
  // the server marks a finalised day needs_update and the status bar says so.
  const handleStopSaved = useCallback(async () => {
    setEditStop(null);
    setRescheduleStop(null);
    setStopError(null);
    await reloadStopData();
    refreshDayRoute();
  }, [reloadStopData, refreshDayRoute]);

  const handleStopNoShow = useCallback(async (stop) => {
    setStopError(null);
    try {
      await base44.functions.invoke('markNoShow', { booking_request_id: stop.requestId });
    } catch (e) {
      setStopError({ stopId: stop.id, message: e?.response?.data?.error || e?.message || 'Could not mark this stop as a no-show.' });
      return;
    }
    setExpandedId(null);
    await reloadStopData();
  }, [reloadStopData]);

  const handleStopCancel = useCallback(async (deposit) => {
    if (!cancelStop) return;
    setCancelBusy(true);
    setCancelError(null);
    // StopCancelDialog asks what happens to the deposit and hands the answer up unchanged.
    const res = await declineBookingRequest({
      booking_request_id: cancelStop.requestId,
      reason: 'Customer cancelled',
      ...deposit,
    });
    setCancelBusy(false);
    if (res?.saved !== true) {
      setCancelError(res?.error || 'The appointment could not be cancelled.');
      return;
    }
    setCancelStop(null);
    setExpandedId(null);
    await reloadStopData();
  }, [cancelStop, reloadStopData]);

  const currentStop = currentIdx >= 0 ? stops[currentIdx] : null;
  const nextStop = currentIdx >= 0 ? stops[currentIdx + 1] : null;
  const currentDriveKey = currentStop && nextStop ? `${currentStop.id}_${nextStop.id}` : null;
  const currentDriveInfo = currentDriveKey ? drivingTimes[currentDriveKey] : null;
  const minsToNext = currentDriveInfo?.state === 'ok' ? currentDriveInfo.mins : null;
  const allDone = isViewingToday && totalStops > 0 && stops.every(s => completedSet.has(s.id) || skippedSet.has(s.id));

  // Map stop id → stop number (appointment order)
  const stopNumbers = useMemo(() => {
    const m = {};
    stops.forEach((s, i) => { m[s.id] = i + 1; });
    return m;
  }, [stops]);

  // Live location: the device is read only while today's current stop is on the way.
  const inTransit = !!currentStop && executions[currentStop.requestId]?.state === 'on_the_way';
  const live = useLiveLocation({ enabled: isViewingToday && totalStops > 0, inTransit, dayEnded: allDone });

  const showCurrentPanel = isViewingToday && currentStop && !allDone;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background h-full relative overflow-hidden">
      <div className="flex-1 overflow-y-auto pb-6">

        {/* ── Date navigator ── */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <button
            onClick={() => setSelectedDate(d => subDays(d, 1))}
            className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center active:opacity-60"
          >
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="text-center">
            <h1 className="text-[17px] font-heading font-bold text-foreground leading-tight">
              {routeTitle(selectedDate)}
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {format(selectedDate, 'EEEE, d MMMM')}
            </p>
          </div>
          <button
            onClick={() => setSelectedDate(d => addDays(d, 1))}
            className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center active:opacity-60"
          >
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* ── Where this day stands: not connected, connected, or needing a reconnect ── */}
        {isViewingToday && totalStops > 0 && !allDone && (
          <LiveLocationToggle sharing={live.sharing} busy={live.busy} note={live.note} lookups={live.lookups} inTransit={inTransit} onToggle={live.toggle} />
        )}
        <RouteEtaLine routes={etaRoutes} showUnavailable={isViewingToday} className="mx-4 mb-3" />
        <RouteStatusBar state={dayRoute} busy={routeBusy} onReconnect={handleReconnect} error={routeError} />

        {/* Two appointments at the same time: named once, and confirmation is blocked
            until one of them moves. Never presented as a servable day. */}
        <RouteConflictBanner conflicts={conflicts} />

        {/* ── The day on the map, beside the stop the barber is on ──
            The route is drawn in the Calendar's order and measured by Google
            Routes; the timeline below keeps the same stop numbers. */}
        {stops.length > 0 && (
          <div className={`px-4 mb-3 grid gap-3 items-start ${showCurrentPanel ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
            <RouteMap
              stops={stops}
              start={mapStart}
              driveTimes={drivingTimes}
              selectedId={mapStopId}
              onSelect={setMapStopId}
            />
            {showCurrentPanel && (
              <CurrentStopPanel
                className="mx-0 mb-0"
                stop={currentStop}
                stopNumber={currentIdx + 1}
                totalStops={totalStops}
                leaveBy={leaveByLabel(currentStop, currentDriveInfo)}
                minsToNext={minsToNext}
                exec={executions[currentStop.requestId]}
                busy={stepBusy}
                error={execError}
                onAdvance={(action, reason) => handleAdvance(currentStop, action, reason)}
                onCheckout={setCheckoutStop}
              />
            )}
          </div>
        )}

        {/* ── Money still owing at stops already completed ── */}
        {stops.filter(s => completedSet.has(s.id)).reverse().map(s => <StopPayment key={s.id} stop={s} />)}

        {/* ── The day at a glance ── */}
        <div className="grid grid-cols-4 gap-2 px-4 mb-2">
          <MetricCard icon={<CalendarDays className="w-4 h-4 text-primary" />} value={totalStops} label="STOPS" />
          <MetricCard icon={<MapPin className="w-4 h-4 text-primary" />} value={fmtMins(breakdown.drivingMins)} label="DRIVING" />
          <MetricCard icon={<DollarSign className="w-4 h-4 text-primary" />} value={`$${metrics.revenue}`} label="REVENUE" accent />
          <MetricCard icon={<Clock className="w-4 h-4 text-foreground" />} value={`${completedCount}/${totalStops}`} label="DONE" />
        </div>
        {provisionalCount > 0 && (
          <p className="mx-4 mb-3 text-[11px] leading-snug text-muted-foreground">
            {totalStops - provisionalCount} confirmed · {provisionalCount} provisional — a provisional time can still move until the day is confirmed.
          </p>
        )}

        {/* ── Time Breakdown ── */}
        {stops.length > 0 && (
          <div className="mx-4 mb-4 bg-card border border-border rounded-2xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3"
              onClick={() => setBreakdownOpen(o => !o)}
            >
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[12px] font-semibold text-foreground">Time Breakdown</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${breakdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {breakdownOpen && (
              <div className="px-4 pb-3 grid grid-cols-5 gap-2 border-t border-border pt-3">
                <BreakdownCell label="Cutting" value={fmtMins(breakdown.cuttingMins)} color="text-primary" />
                <BreakdownCell label="Buffer" value={fmtMins(breakdown.bufferMins)} color="text-blue-400" />
                <BreakdownCell label="Driving" value={fmtMins(breakdown.drivingMins)} color="text-foreground" />
                <BreakdownCell label="Idle" value={fmtMins(breakdown.idleMins)} color="text-amber-400" />
                <BreakdownCell label="Breaks" value={fmtMins(breakdown.breaksMins)} color="text-green-400" />
              </div>
            )}
          </div>
        )}

        {/* ── Full-day timeline ── */}
        {stops.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-8">
            <MapPin className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
            <p className="text-sm font-semibold text-muted-foreground">No appointments for {format(selectedDate, 'EEEE')}</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Use the Schedule tab to plan this day.</p>
          </div>
        ) : (
          <div className="px-3 pb-2">
            {/* The day begins at the barber's start location — the first leg is
                part of the route, not a detail. */}
            {finalised && (
              <RouteStartBlock
                startLocation={dayRoute?.start_location_address}
                firstLegMinutes={dayRoute?.first_leg_minutes}
                firstStart={stops[0]?.apptStart}
              />
            )}
            {timeline.map((block, idx) => {
              const isAppt = block.type === 'appointment';
              const stopId = block.stopId;
              const isCompleted = isAppt && completedSet.has(stopId);
              const isCurrent = isViewingToday && isAppt && stopId === currentStop?.id && !isCompleted;
              const isExpanded = isAppt && expandedId === stopId;

              // Show timestamp only on appointment blocks or when time jumps significantly
              const showTimestamp = isAppt || block.type === 'idle' || block.type === 'lunch';

              return (
                <TimelineBlock
                  key={block.id}
                  block={block}
                  isCompleted={isCompleted}
                  isCurrent={isCurrent}
                  isLast={idx === timeline.length - 1}
                  stopNumber={isAppt ? stopNumbers[stopId] : null}
                  currentDriveInfo={isCurrent ? currentDriveInfo : null}
                  currentCardRef={currentCardRef}
                  showTimestamp={showTimestamp}
                  lateInfo={isAppt ? lateMap[block.stop?.requestId] : null}
                  isExpanded={isExpanded}
                  onToggle={isAppt ? () => {
                    setStopError(null);
                    setExpandedId(cur => (cur === stopId ? null : stopId));
                  } : undefined}
                  details={isExpanded ? (
                    <StopDetailsPanel
                      stop={block.stop}
                      exec={executions[block.stop?.requestId]}
                      busy={stepBusy}
                      // The current stop's execution buttons sit in the bar above,
                      // so they are not offered a second time on the same screen.
                      hideExecution={isViewingToday && currentStop?.id === stopId && !allDone}
                      error={stopError?.stopId === stopId ? stopError.message : null}
                      onEdit={setEditStop}
                      onReschedule={setRescheduleStop}
                      onComplete={(stop) => handleAdvance(stop, 'complete')}
                      onCheckout={setCheckoutStop}
                      onCancel={(stop) => { setCancelError(null); setCancelStop(stop); }}
                      onNoShow={handleStopNoShow}
                    />
                  ) : null}
                />
              );
            })}
          </div>
        )}
      </div>

      {checkoutStop && (
        <StopCheckout
          stop={checkoutStop}
          execution={executions[checkoutStop.requestId]}
          catalogue={catalogue}
          onClose={() => setCheckoutStop(null)}
          onChanged={() => { reloadExecutions(); loadAppointments(); refreshEta(); }}
        />
      )}

      {/* Editing a booking from its Route card: the Calendar's own editor, over the timeline. */}
      {editStop && (
        <StopEditDialog
          stop={editStop}
          onClose={() => setEditStop(null)}
          onSaved={handleStopSaved}
        />
      )}

      {rescheduleStop && (
        <StopRescheduleDialog
          stop={rescheduleStop}
          onClose={() => setRescheduleStop(null)}
          onSaved={handleStopSaved}
        />
      )}

      {cancelStop && (
        <StopCancelDialog
          stop={cancelStop}
          busy={cancelBusy}
          error={cancelError}
          onClose={() => { setCancelStop(null); setCancelError(null); }}
          onConfirm={handleStopCancel}
        />
      )}

      {/* All done panel */}
      {allDone && (
        <div className="border-t border-border bg-card px-4 py-4 text-center">
          <p className="text-sm font-bold text-green-600 mb-0.5">All done for today!</p>
          <p className="text-xs text-muted-foreground">{totalStops} stops · ${metrics.revenue} earned</p>
        </div>
      )}

      {/* Future / past panel */}
      {!isViewingToday && totalStops > 0 && (
        <div className="border-t border-border bg-card px-4 py-3">
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase mb-1">
            {isPast ? 'Past Route' : 'Planned Route'}
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            {isPast ? 'Route history for this day.' : 'Use Schedule to edit or confirm this route.'}
          </p>
          {!isPast && (
            <Link to="/admin/schedule" className="w-full flex items-center justify-center bg-secondary border border-border text-foreground text-sm font-semibold py-2.5 rounded-xl">
              Open in Schedule
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────── */

function MetricCard({ icon, value, label, accent }) {
  return (
    <div className="bg-card border border-border rounded-2xl px-1.5 py-3 flex flex-col items-center gap-1.5">
      <div>{icon}</div>
      <p className={`text-[13px] font-bold leading-none text-center ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
      <p className="text-[8px] font-semibold text-muted-foreground tracking-wider uppercase text-center leading-tight">{label}</p>
    </div>
  );
}

function BreakdownCell({ label, value, color }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <p className="text-[9px] text-muted-foreground text-center">{label}</p>
      <p className={`text-[12px] font-bold ${color}`}>{value}</p>
    </div>
  );
}