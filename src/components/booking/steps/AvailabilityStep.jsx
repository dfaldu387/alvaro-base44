import React, { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Clock, MapPin, AlertCircle } from 'lucide-react';
import DateRibbon from '@/components/booking/DateRibbon';
import AvailabilityTimeline from '@/components/booking/AvailabilityTimeline';
import AfterHoursPanel from '@/components/booking/AfterHoursPanel';
import { decimalToLabel } from '@/lib/demandUtils';
import { AVAILABILITY_STATUS, allowedDateStrings, dateFromDateString } from '@/lib/bookingDateUtils';

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function decimalToLabelInverse(label) {
  if (!label) return null;
  const m = label.toLowerCase().trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3] || '';
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h + min / 60;
}

// Step 3 — Availability: "When are you available?"
// Status comes directly from backend daySummaries (authoritative per-date).
// Only "closed" prevents selection; "waitlist" remains fully selectable.
export default function AvailabilityStep({
  selectedArea,
  serviceAreas,
  barberHours,
  dayConfig,
  allRequests,
  daySummaries,
  maxBookingsPerDay,
  selectedDate,
  onSelectDate,
  range,
  onRangeChange,
  bookingMode,
  setBookingMode,
  afterHoursMode,
  setAfterHoursMode,
  afterHoursSlot,
  setAfterHoursSlot,
  afterOpen,
  setAfterOpen,
  totalMins,
  onContinue,
  onBack,
  customerLocation,
  loading = false,
}) {
  const [showWideConfirm, setShowWideConfirm] = useState(false);
  const [wideConfirmed, setWideConfirmed] = useState(null);

  const getDayPeriods = (day) => (day && dayConfig?.dayPeriods?.[day]) || [];

  // Reserved blocks = confirmed/completed bookings for the specific date
  const getBusyAppts = (dateStr, dayName) => {
    const periods = getDayPeriods(dayName);
    const dayMin = periods.length ? periods[0].start : 9;
    const dayMax = periods.length ? periods[periods.length - 1].end : 21;
    return allRequests
      // A booking with no date never blocks a slot (matching by weekday would block it on every date).
      .filter(r => r.requested_date === dateStr)
      .filter(r => r.assigned_time && (r.status === 'confirmed' || r.status === 'completed'))
      .map(r => {
        const start = decimalToLabelInverse(r.assigned_time);
        if (start == null) return null;
        const dur = (r.duration_mins || 30) / 60;
        return { startDecimal: start, endDecimal: start + dur, clientName: r.client_name };
      })
      .filter(Boolean)
      .map(b => ({
        ...b,
        startDecimal: Math.max(b.startDecimal, dayMin),
        endDecimal: Math.min(b.endDecimal, dayMax),
      }));
  };

  // ── Backend-driven status from daySummaries ──
  const selectedDateStr = selectedDate ? formatDateStr(selectedDate) : '';
  const selectedSummary = selectedDate ? (daySummaries?.[selectedDateStr] || null) : null;
  const selectedDay = selectedDate ? FULL_DAYS[selectedDate.getDay()] : '';
  const selectedDateLabel = selectedDate ? `${selectedDay} ${selectedDate.getDate()} ${MONTHS[selectedDate.getMonth()]}` : '';
  const selectedStatus = selectedSummary?.customer_status || 'closed';
  const selectedZones = selectedSummary?.priority_zones || [];
  const showTimeline = selectedStatus !== 'closed';

  const switchDay = (date) => {
    const dateStr = formatDateStr(date);
    const summary = daySummaries?.[dateStr];
    const status = summary?.customer_status || 'closed';
    const dayName = FULL_DAYS[date.getDay()];
    onSelectDate(date);
    setBookingMode('normal');
    setAfterHoursMode(null);
    setAfterHoursSlot(null);
    if (status !== 'closed') {
      const periods = getDayPeriods(dayName);
      const afterHours = periods.some(p => p.name === 'Evening');
      const closing = periods.length ? periods[periods.length - 1].end : 18;
      const dayMaxEnd = afterHours ? 18 : closing;
      const min = Math.max(9, periods.length ? periods[0].start : 9);
      const max = Math.min(dayMaxEnd, closing);
      onRangeChange([min, max]);
    }
    setWideConfirmed(null);
  };

  // ── Date carousel from the backend booking window ──
  // daySummaries holds exactly the dates a customer may book: the Booking Rules
  // minimum notice and booking horizon are already applied server-side. The
  // ribbon therefore renders those dates and nothing else, so a date outside the
  // window cannot be selected — and the backend re-checks on submit, so this is
  // never the only enforcement.
  const ribbonDays = useMemo(() => {
    return allowedDateStrings(daySummaries)
      .map(dateStr => {
        const d = dateFromDateString(dateStr);
        if (!d) return null;
        const summary = daySummaries?.[dateStr];
        return {
          date: d,
          dateStr,
          dayName: summary?.day_of_week || FULL_DAYS[d.getDay()],
          dow: DOW_SHORT[d.getDay()],
          dateNum: d.getDate(),
          status: summary?.customer_status || 'closed',
          zones: summary?.priority_zones || [],
        };
      })
      .filter(Boolean);
  }, [daySummaries]);

  // Days the customer can actually pick, plus the safe fallback for the selected
  // date: when the parent holds no valid date yet we select the first bookable
  // day through exactly the same path as tapping a card, so the highlight, the
  // heading and the panel can never disagree. Once a valid date exists this
  // never runs again — no loop, and selection stays the single source of truth.
  const selectableDays = useMemo(() => ribbonDays.filter(d => d.status !== 'closed'), [ribbonDays]);
  const firstSelectableDate = selectableDays[0]?.date || null;
  const dateMissing = !(selectedDate instanceof Date) || isNaN(selectedDate.getTime());

  useEffect(() => {
    if (!dateMissing || !firstSelectableDate) return;
    switchDay(firstSelectableDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateMissing, firstSelectableDate]);

  const dayPeriodsList = getDayPeriods(selectedDay);
  const closingTime = dayPeriodsList.length ? dayPeriodsList[dayPeriodsList.length - 1].end : 18;
  const afterHoursEnabled = dayPeriodsList.some(p => p.name === 'Evening');
  const maxAvailabilityEnd = afterHoursEnabled ? 18 : closingTime;

  const afterHoursSlots = useMemo(() => {
    if (!afterHoursEnabled) return [];
    const AFTER_HOURS_CLOSE = 21;
    const slotDecimals = [19, 19.5, 20, 20.5, 21];
    const durHrs = totalMins / 60;
    const busy = getBusyAppts(selectedDateStr, selectedDay);
    return slotDecimals
      .filter(start => start + durHrs <= AFTER_HOURS_CLOSE)
      .filter(start => {
        const end = start + durHrs;
        return !busy.some(b => start < b.endDecimal && end > b.startDecimal);
      })
      .map(d => decimalToLabel(d));
  }, [afterHoursEnabled, totalMins, selectedDateStr, selectedDay, allRequests, dayConfig]);

  const minWindowHrs = 1;
  const timesValid = range[1] - range[0] >= minWindowHrs;
  const windowMins = bookingMode === 'normal' ? (range[1] - range[0]) * 60 : 0;
  const isWide = windowMins > 300;
  const wideChanged = !wideConfirmed || Math.abs(wideConfirmed[0] - range[0]) > 0.5 || Math.abs(wideConfirmed[1] - range[1]) > 0.5;
  const canContinue = showTimeline && (bookingMode === 'normal' ? timesValid : !!(afterHoursMode && afterHoursSlot));

  useEffect(() => {
    if (afterHoursSlot && !afterHoursSlots.includes(afterHoursSlot)) setAfterHoursSlot(null);
  }, [afterHoursSlots, afterHoursSlot]);

  const handleRangeChange = (r) => {
    onRangeChange(r);
    if (bookingMode !== 'normal') {
      setBookingMode('normal');
      setAfterHoursMode(null);
      setAfterHoursSlot(null);
    }
  };

  const handleAfterHoursOption = (m) => { setAfterHoursMode(m); setBookingMode('after_hours'); };
  const handleAfterHoursSlot = (s) => { setAfterHoursSlot(s); setBookingMode('after_hours'); };

  const handleContinue = () => {
    if (!showTimeline) return;
    if (bookingMode === 'normal' && isWide && wideChanged) {
      setShowWideConfirm(true);
      return;
    }
    onContinue();
  };

  const confirmWide = () => {
    setWideConfirmed([range[0], range[1]]);
    setShowWideConfirm(false);
    onContinue();
  };

  return (
    <div className="space-y-4 pb-28 lg:pb-0">
      {/* Heading */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} aria-label="Go back" className="w-9 h-9 -ml-1 flex items-center justify-center rounded-lg hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-[17px] font-heading font-bold text-foreground">When are you available?</h1>
        <div className="w-9" />
      </div>

      <p className="text-xs text-muted-foreground text-center -mt-1 leading-relaxed">
        Select the full period you're genuinely available. Your exact appointment time will be confirmed later.
      </p>

      {/* Customer location */}
      {customerLocation && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{customerLocation.formatted_address}</span>
        </div>
      )}

      {/* Nothing date-dependent renders until the data and the selected date are
          both ready — so a missing date or a failed load can never blank the page */}
      {loading || (dateMissing && selectableDays.length > 0) ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-8 flex items-center justify-center gap-2.5">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">Loading availability…</p>
        </div>
      ) : selectableDays.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-zinc-500/10">
              <AlertCircle className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">No available dates</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                No available dates found. Please try another service area or date range.
              </p>
            </div>
          </div>
        </div>
      ) : (
      <>
      {/* Date carousel */}
      <div>
        <p className="text-[12px] text-muted-foreground text-center mb-2">Swipe left or right to view other days</p>
        <DateRibbon days={ribbonDays} selectedDate={selectedDate} onSelect={switchDay} />
      </div>

      {/* Availability legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
        {['available', 'in_demand', 'limited', 'waitlist', 'closed'].map(s => {
          const info = AVAILABILITY_STATUS[s];
          return (
            <span key={s} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={`w-2 h-2 rounded-full ${info.dot}`} />
              {info.label}
            </span>
          );
        })}
      </div>

      {/* Selected date + status + priority zones */}
      {selectedDate && (
        <div className="rounded-2xl border border-border bg-card px-3.5 py-3">
          {/* Date + status on one row; status wraps beneath on narrow screens */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-[14px] font-bold text-foreground">{selectedDateLabel}</p>
            <span className="inline-flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${AVAILABILITY_STATUS[selectedStatus]?.dot || 'bg-zinc-500'}`} />
              <p className="text-xs font-bold text-foreground">{AVAILABILITY_STATUS[selectedStatus]?.label || 'Closed'}</p>
            </span>
          </div>

          {/* Service areas — where */}
          {selectedZones.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Service areas</p>
              <div className="space-y-1">
                {selectedZones.map((z, zi) => (
                  <div key={z.id || zi} className="flex items-center gap-1.5">
                    <span style={{ backgroundColor: z.colour }} className="w-2 h-2 rounded-full shrink-0" />
                    <p className="text-xs font-semibold text-foreground">{z.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Waitlist message only */}
          {selectedStatus === 'waitlist' && (
            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
              This day is currently full, but you can still submit a request. We'll notify you if a spot becomes available.
            </p>
          )}
        </div>
      )}

      {/* Timeline + lower controls */}
      {showTimeline ? (
        <>
          {/* The one genuinely unfamiliar idea on this site: no exact time is chosen here,
              because the barber drives a route. It used to be a grey footnote under a
              heading, which is the least prominent thing on the step it governs. It now
              leads, and says what the customer gets back for being flexible — otherwise
              the page asks for something and offers nothing in return. */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
            <p className="text-sm font-bold text-foreground">
              Pick a window you can be available — not an exact time
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your barber travels to you, so we fit you into the day's route. Only choose
              hours you can genuinely be there for.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              In return you'll get your exact arrival time the day before, a text when your
              barber is on the way, and live tracking on the day.
            </p>
          </div>

          <AvailabilityTimeline
            value={range}
            onChange={handleRangeChange}
            maxEnd={maxAvailabilityEnd}
            busyAppts={getBusyAppts(selectedDateStr, selectedDay)}
            minWindowMins={totalMins}
            durationMins={totalMins}
          />

          {afterHoursEnabled && (
            <AfterHoursPanel
              expanded={afterOpen}
              onToggle={() => setAfterOpen(v => !v)}
              mode={afterHoursMode}
              onMode={handleAfterHoursOption}
              slot={afterHoursSlot}
              onSlot={handleAfterHoursSlot}
              slots={afterHoursSlots}
            />
          )}
        </>
      ) : (
        selectedDate && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-zinc-500/10">
                <AlertCircle className="w-4 h-4 text-zinc-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Closed</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Your barber isn't accepting bookings on this date. Please choose another day.
                </p>
              </div>
            </div>
          </div>
        )
      )}
      </>
      )}

      {/* ── Continue button ── */}
      {/* Mobile: sticky bottom bar. Desktop: normal page-flow button. */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t border-border px-5 py-3 lg:hidden">
        <button
          disabled={!canContinue}
          onClick={handleContinue}
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#7c2bd6] to-[#9b4ef0] text-white font-bold text-[15px] shadow-[0_8px_24px_rgba(139,61,255,0.35)] active:scale-[0.98] transition-all disabled:opacity-40 disabled:shadow-none"
        >
          Continue
        </button>
      </div>
      <button
        disabled={!canContinue}
        onClick={handleContinue}
        className="hidden lg:flex w-full h-12 rounded-2xl bg-gradient-to-r from-[#7c2bd6] to-[#9b4ef0] text-white font-bold text-[15px] shadow-[0_8px_24px_rgba(139,61,255,0.35)] active:scale-[0.98] transition-all disabled:opacity-40 disabled:shadow-none items-center justify-center"
      >
        Continue
      </button>

      {/* Wide availability confirmation (over 5 hours) */}
      {showWideConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowWideConfirm(false)}>
          <div className="w-full max-w-md mx-4 mb-4 sm:mb-0 rounded-2xl border border-[#2a2a2e] bg-[#141418] p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/12 border border-blue-500/25 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-bold text-foreground leading-tight">Wide availability</p>
                <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">You've selected more than 5 hours. Only continue if you'll genuinely be available throughout this entire window.</p>
              </div>
            </div>
            <div className="space-y-2">
              <button className="w-full bg-primary hover:bg-primary/90 text-white font-bold text-sm py-3 rounded-xl transition-all" onClick={confirmWide}>
                Yes, I'm available
              </button>
              <button className="w-full bg-secondary border border-border text-foreground font-semibold text-sm py-3 rounded-xl transition-all" onClick={() => setShowWideConfirm(false)}>
                Adjust window
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}