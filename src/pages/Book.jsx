import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Send, CalendarCheck, MessageSquare, ArrowRight } from 'lucide-react';
import BookingHeader from '@/components/booking/BookingHeader';
import LegalLinks from '@/components/legal/LegalLinks';
import StepProgress from '@/components/booking/StepProgress';
import RegionStep from '@/components/booking/steps/RegionStep';
import ServicesStep from '@/components/booking/steps/ServicesStep';
import AvailabilityStep from '@/components/booking/steps/AvailabilityStep';
import BookingErrorBoundary from '@/components/booking/BookingErrorBoundary';
import DetailsStep from '@/components/booking/steps/DetailsStep';
import ReviewStep from '@/components/booking/steps/ReviewStep';
import { computeGroupDiscount, getMaxGroupBookingPeople, getMaxBookingsPerDay } from '@/lib/groupPricing';
import { buildDayConfig } from '@/lib/serviceAreaUtils';
import { decimalToLabel } from '@/lib/demandUtils';
import { setMapboxToken } from '@/lib/mapboxToken';
import { findFirstBookableDate, formatAppointmentDate } from '@/lib/bookingDateUtils';
import useDepositQuote from '@/hooks/useDepositQuote';

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STEP_LABELS = ['Location', 'Services', 'Availability', 'Details', 'Review'];

function validateAuPhone(v) {
  return /^(\+?61\s?)?0?4\d{2}\s?\d{3}\s?\d{3}$/.test(v.trim());
}

function validateEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// Match an address string against Service Area suburbs/postcodes.
// Returns the first matching area, or null if no match.
function matchAreaFromAddress(address, serviceAreas) {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const area of serviceAreas) {
    if (area.centre_suburb && area.centre_suburb.length > 2 && lower.includes(area.centre_suburb.toLowerCase())) return area;
    for (const suburb of (area.suburbs || [])) {
      if (suburb && suburb.length > 2 && lower.includes(suburb.toLowerCase())) return area;
    }
    for (const postcode of (area.postcodes || [])) {
      if (postcode && lower.includes(postcode)) return area;
    }
  }
  return null;
}

// Desktop-only rail beside the form. It reads the same derived values the Review
// step is given, so the running total here and the one on Review can never disagree.
// Hidden below lg, where the single column is already the whole screen.
function BookingSummary({
  selectedArea, address, personItems, peopleCount, totalMins,
  subtotal, totalSavings, calloutFee, totalPrice,
  hasDate, formattedDate, availabilityLabel,
}) {
  const chosen = personItems.filter(p => p.primary);
  const nothingYet = !address && chosen.length === 0 && !hasDate;

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-8 rounded-[1.5rem] border border-white/[0.07] bg-white/[0.02] p-1.5">
        <div className="rounded-[calc(1.5rem-0.375rem)] border border-white/[0.06] bg-card p-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Your booking
          </p>

          {nothingYet ? (
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              Your location, services and preferred day will appear here as you go.
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              {address && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Where</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground">{address}</p>
                  {selectedArea && (
                    <span className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: selectedArea.colour || '#6f22cf' }}
                      />
                      {selectedArea.name}
                    </span>
                  )}
                </div>
              )}

              {chosen.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {peopleCount > 1 ? `${peopleCount} people` : 'Service'}
                  </p>
                  <ul className="mt-2 space-y-2.5">
                    {chosen.map(({ primary, addons: pa }, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-4">
                        <span className="min-w-0">
                          <span className="text-sm text-foreground">{primary.name}</span>
                          {pa.length > 0 && (
                            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                              + {pa.map(a => a.name).join(', ')}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          ${primary.price + pa.reduce((sum, a) => sum + (a.price_adjustment || 0), 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-xs text-muted-foreground">About {totalMins} mins</p>
                </div>
              )}

              {hasDate && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">When</p>
                  <p className="mt-1.5 text-sm text-foreground">{formattedDate}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{availabilityLabel}</p>
                </div>
              )}
            </div>
          )}

          {chosen.length > 0 && (
            <div className="mt-6 space-y-2 border-t border-white/[0.07] pt-5">
              <div className="flex items-baseline justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>${subtotal}</span>
              </div>
              {totalSavings > 0 && (
                <div className="flex items-baseline justify-between text-sm text-emerald-400">
                  <span>Group savings</span>
                  <span>&minus;${totalSavings}</span>
                </div>
              )}
              {calloutFee > 0 && (
                <div className="flex items-baseline justify-between text-sm text-muted-foreground">
                  <span>After-hours callout</span>
                  <span>+${calloutFee}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-2">
                <span className="text-sm text-foreground">Total</span>
                <span className="font-heading text-2xl font-bold text-foreground">${totalPrice}</span>
              </div>
            </div>
          )}

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            This is a request, not a confirmed booking. The exact arrival time is sent the day before.
          </p>
        </div>
      </div>
    </aside>
  );
}

export default function Book() {
  // ── Data ──
  const [serviceAreas, setServiceAreas] = useState([]);
  const [services, setServices] = useState([]);
  const [addons, setAddons] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [groupDiscountSettings, setGroupDiscountSettings] = useState(null);
  const [serviceCoverage, setServiceCoverage] = useState(null);
  const [barberHours, setBarberHours] = useState([]);
  const [daySummaries, setDaySummaries] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ── Step ──
  const [step, setStep] = useState(1);

  // ── Region (Step 1) ──
  const [serviceAreaId, setServiceAreaId] = useState(null);
  const [priorityStatus, setPriorityStatus] = useState('priority');

  // ── Services (Step 2) ──
  const [participants, setParticipants] = useState([{ id: 'p1', primary_service_id: null, addon_ids: [] }]);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());

  // ── Availability (Step 3) ──
  const [selectedDate, setSelectedDate] = useState(null);
  const [range, setRange] = useState([9, 18]);
  const [bookingMode, setBookingMode] = useState('normal');
  const [afterHoursMode, setAfterHoursMode] = useState(null);
  const [afterHoursSlot, setAfterHoursSlot] = useState(null);
  const [afterOpen, setAfterOpen] = useState(false);

  // ── Details (Step 4) ──
  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [messagingConsent, setMessagingConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [regionNotice, setRegionNotice] = useState(null);
  const [customerLocation, setCustomerLocation] = useState(null);
  const [editModeFromReview, setEditModeFromReview] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  // ── Submit ──
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  // Deposit decision returned by the server after submitting (informational).
  const [deposit, setDeposit] = useState(null);
  const [showSlowNotice, setShowSlowNotice] = useState(false);

  // ── Booking session ──
  // One session per appointment the customer is making. A retry inside a session
  // reuses the key (so a resend can never create a second record), while "Book
  // another appointment" starts a NEW session with a NEW key — the next
  // appointment is a new request, never a retry of the previous one.
  const newSessionToken = () => (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const sessionTokenRef = useRef(newSessionToken());
  // Bumped when a session ends, so an in-flight submit (or a stale timer) from the
  // previous booking can never change the state of the new one.
  const sessionSeqRef = useRef(0);
  const submittingRef = useRef(false);
  const submitTimersRef = useRef([]);

  const clearSubmitTimers = () => {
    submitTimersRef.current.forEach(id => clearTimeout(id));
    submitTimersRef.current = [];
  };

  const startNewSession = () => {
    sessionSeqRef.current += 1;      // invalidate any in-flight submit
    clearSubmitTimers();             // slow notice, call timeout, retries
    submittingRef.current = false;   // the previous submission no longer blocks this one
    sessionTokenRef.current = newSessionToken();
  };

  // ── Data loading ──
  const urlHandledRef = useRef(false);
  useEffect(() => {
    base44.functions.invoke('publicBookingData', {})
      .then(res => {
        setServiceAreas(res.data.serviceAreas || []);
        setServices(res.data.services || []);
        setAddons(res.data.addons || []);
        setAllRequests(res.data.bookings || []);
        setGroupDiscountSettings(res.data.groupDiscountSettings || null);
        setServiceCoverage(res.data.serviceCoverage || null);
        setBarberHours(res.data.barberHours || []);
        setDaySummaries(res.data.daySummaries || {});
        setMapboxToken(res.data?.mapboxToken);

        // Handle ?area= URL param — preselect area and skip to Services
        if (!urlHandledRef.current) {
          urlHandledRef.current = true;
          const urlParams = new URLSearchParams(window.location.search);
          const areaId = urlParams.get('area');
          if (areaId && (res.data.serviceAreas || []).some(a => a.id === areaId)) {
            setServiceAreaId(areaId);
            setPriorityStatus('priority');
            setStep(2);
          }
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const reload = () => {
    setLoading(true); setLoadError(null);
    base44.functions.invoke('publicBookingData', {})
      .then(res => {
        setServiceAreas(res.data.serviceAreas || []);
        setServices(res.data.services || []);
        setAddons(res.data.addons || []);
        setAllRequests(res.data.bookings || []);
        setGroupDiscountSettings(res.data.groupDiscountSettings || null);
        setServiceCoverage(res.data.serviceCoverage || null);
        setBarberHours(res.data.barberHours || []);
        setDaySummaries(res.data.daySummaries || {});
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  // ── Derived values ──
  const selectedArea = useMemo(() => serviceAreas.find(a => a.id === serviceAreaId) || null, [serviceAreas, serviceAreaId]);

  // Always build from ALL active service areas — the calendar shows every
  // working day regardless of the customer's matched zone. Each date
  // displays the priority zone(s) scheduled for that day.
  const maxBookingsPerDay = getMaxBookingsPerDay(groupDiscountSettings);

  // Build from barber working hours (WHEN) + ServiceAreas (WHERE) + capacity (HOW MUCH).
  // The barber's TeamMember.working_hours is the source of truth for open/closed dates and hours.
  // ServiceAreas only contribute the priority zone label for each day.
  const dayConfig = useMemo(() => {
    return buildDayConfig(barberHours, serviceAreas, maxBookingsPerDay);
  }, [barberHours, serviceAreas, maxBookingsPerDay]);

  const peopleCount = participants.length;
  const isGroupBooking = peopleCount >= 2;
  const allHavePrimary = participants.every(p => p.primary_service_id);

  const personItems = useMemo(() => participants.map(p => {
    const primary = services.find(s => s.id === p.primary_service_id) || null;
    const pAddons = p.addon_ids.map(id => addons.find(a => a.id === id)).filter(Boolean);
    return { primary, addons: pAddons };
  }), [participants, services, addons]);

  const allServiceNames = useMemo(() => personItems.flatMap(({ primary, addons: pa }) => {
    const names = [];
    if (primary) names.push(primary.name);
    for (const a of pa) names.push(a.name);
    return names;
  }), [personItems]);

  const primaryServiceCount = personItems.filter(({ primary }) => primary).length;
  const addonCount = personItems.reduce((sum, { addons: pa }) => sum + pa.length, 0);
  const subtotal = personItems.reduce((sum, { primary, addons: pa }) => {
    let t = primary ? primary.price : 0;
    for (const a of pa) t += a.price_adjustment || 0;
    return sum + t;
  }, 0);
  const totalMins = personItems.reduce((sum, { primary, addons: pa }) => {
    let t = primary ? primary.duration_mins : 0;
    for (const a of pa) t += a.duration_adjustment || 0;
    return sum + t;
  }, 0);
  const totalSavings = computeGroupDiscount(peopleCount, subtotal, groupDiscountSettings);
  const calloutFee = bookingMode === 'after_hours' && afterHoursMode === 'mobile_callout' && afterHoursSlot ? 50 : 0;
  const totalPrice = subtotal - totalSavings + calloutFee;
  const maxGroupPeople = getMaxGroupBookingPeople(groupDiscountSettings);
  const atMaxPeople = peopleCount >= maxGroupPeople;

  const selectedDay = selectedDate ? FULL_DAYS[selectedDate.getDay()] : '';
  const selectedDateStr = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
    : '';
  const priorityZones = (daySummaries[selectedDateStr]?.priority_zones) || [];
  const availabilityLabel = bookingMode === 'after_hours' && afterHoursSlot
    ? afterHoursSlot
    : `${decimalToLabel(range[0])}–${decimalToLabel(range[1])}`;
  const formattedDate = formatAppointmentDate(selectedDate);

  // ── Step 1: Region handlers ──
  const handleSelectArea = (id) => {
    setServiceAreaId(id);
    setPriorityStatus('priority');
  };
  const handleSelectOutside = () => {
    setServiceAreaId(null);
    setPriorityStatus('outside_priority');
  };
  const handleRegionContinue = () => {
    if (editModeFromReview) {
      setStep(5);
      setEditModeFromReview(false);
      setEditingStep(null);
    } else {
      setStep(2);
    }
  };

  // ── Step 2: Services handlers ──
  const addPerson = () => {
    const newId = `p${Date.now()}`;
    setParticipants(prev => [...prev, { id: newId, primary_service_id: null, addon_ids: [] }]);
    setCollapsedIds(prev => { const n = new Set(prev); n.delete(newId); return n; });
  };
  const collapsePerson = (pid) => setCollapsedIds(prev => { const n = new Set(prev); n.add(pid); return n; });
  const expandPerson = (pid) => setCollapsedIds(prev => { const n = new Set(prev); n.delete(pid); return n; });
  const removePerson = (pid) => setParticipants(prev => prev.length > 1 ? prev.filter(p => p.id !== pid) : prev);
  const selectPrimary = (pid, sid) => setParticipants(prev => prev.map(p => p.id === pid ? { ...p, primary_service_id: sid } : p));
  const toggleAddon = (pid, aid) => setParticipants(prev => prev.map(p => {
    if (p.id !== pid) return p;
    const has = p.addon_ids.includes(aid);
    return { ...p, addon_ids: has ? p.addon_ids.filter(x => x !== aid) : [...p.addon_ids, aid] };
  }));

  const initDay = () => {
    // The backend's daySummaries already respects the Booking Rules window, so
    // the first date offered here is the first date the customer may book.
    const firstDate = findFirstBookableDate(dayConfig?.bookableDays, daySummaries);
    if (!firstDate) return;
    const dayName = FULL_DAYS[firstDate.getDay()];
    const periods = dayConfig?.dayPeriods?.[dayName] || [];
    const min = Math.max(9, periods.length ? periods[0].start : 9);
    const max = Math.min(21, periods.length ? periods[periods.length - 1].end : 18);
    setSelectedDate(firstDate);
    setRange([min, max]);
  };

  const handleServicesContinue = () => {
    if (!allHavePrimary) return;
    if (!selectedDate) initDay();
    if (editModeFromReview) {
      // Verify availability window is still long enough for the new service duration
      const minWindowHrs = Math.max(0.5, Math.ceil((totalMins / 60) * 2) / 2);
      if (range[1] - range[0] < minWindowHrs) {
        setEditingStep(3);
        setStep(3);
        return;
      }
      setStep(5);
      setEditModeFromReview(false);
      setEditingStep(null);
    } else {
      setStep(3);
    }
  };

  const handleAvailabilityContinue = () => {
    if (editModeFromReview) {
      setStep(5);
      setEditModeFromReview(false);
      setEditingStep(null);
    } else {
      setStep(4);
    }
  };

  const handleStepBack = (targetStep) => {
    setEditModeFromReview(false);
    setEditingStep(null);
    setStep(targetStep);
  };

  // ── Step 4: Details handlers ──
  const handleFieldChange = (field, value) => {
    if (field === 'clientName') setClientName(value);
    if (field === 'phone') setPhone(value);
    if (field === 'email') setEmail(value);
    if (field === 'notes') setNotes(value);
    if (field === 'messagingConsent') setMessagingConsent(value === true);
    if (fieldErrors[field]) setFieldErrors(prev => ({ ...prev, [field]: null }));
  };

  const validateDetails = () => {
    const errors = {};
    if (!clientName.trim() || clientName.trim().length < 2) errors.clientName = 'Please enter your full name.';
    if (!validateAuPhone(phone)) errors.phone = 'Please enter a valid Australian mobile number.';
    if (email.trim() && !validateEmail(email)) errors.email = 'Please enter a valid email address.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleDetailsContinue = () => {
    if (!validateDetails()) return;
    setEditModeFromReview(false);
    setEditingStep(null);
    setStep(5);
  };

  // ── Step 5: Review handlers ──
  const handleEditStep = (stepNum) => {
    if (stepNum === 1) setRegionNotice(null);
    if (stepNum === 3 && !selectedDate) initDay();
    setEditModeFromReview(true);
    setEditingStep(stepNum);
    setStep(stepNum);
  };

  const handleUpdateContactDetails = (details) => {
    setClientName(details.clientName);
    setPhone(details.phone);
    setEmail(details.email);
    setNotes(details.notes);
  };

  // ── Submit ──
  // The customer waits ONLY for the booking request to be saved. Route Flow —
  // auto-placement, candidate slots, Mapbox travel, drive/idle scoring, Stage 2
  // optimisation, decision logging, analytics and reminders — runs server-side
  // afterwards, driven by the saved BookingRequest itself. It can therefore
  // never hold up "Submitting…", and closing the page never stops it.
  //
  // Each session sends its own key. A retry inside a session carries the same key
  // and is answered with the booking that already exists — which is what makes one
  // automatic retry after a stall safe — while the next appointment carries a new
  // key and is created as a new request.
  // The booking itself, as the server reads it. Submitting sends it with the session key; the Review
  // step's deposit quote sends the same fields so both are worked out from one set of answers.
  const buildBookingFields = () => {
    const overlapBlocks = !selectedDay ? [] : (dayConfig.dayPeriods[selectedDay] || [])
      .filter(p => range[0] < p.end && range[1] > p.start)
      .map(p => p.name);
    const capacityStatusAtSubmission = daySummaries[selectedDateStr]?.customer_status || 'available';
    return {
      client_name: clientName,
      phone,
      email,
      address: customerLocation?.formatted_address || '',
      day: selectedDay,
      capacity_status_at_submission: capacityStatusAtSubmission,
      time_blocks: overlapBlocks,
      time_block: overlapBlocks[0] || '',
      availability_window: availabilityLabel,
      services: allServiceNames,
      participants: participants.map(p => ({
        primary_service: services.find(s => s.id === p.primary_service_id)?.name || '',
        addons: p.addon_ids.map(id => addons.find(a => a.id === id)?.name).filter(Boolean),
      })),
      notes,
      after_hours_mode: bookingMode === 'after_hours' ? afterHoursMode : null,
      after_hours_slot: bookingMode === 'after_hours' ? afterHoursSlot : null,
      service_area_id: serviceAreaId || '',
      priority_status: priorityStatus,
      requested_date: selectedDateStr,
      address_lat: customerLocation?.lat ?? null,
      address_lng: customerLocation?.lng ?? null,
      address_postcode: customerLocation?.postcode || '',
      address_suburb: customerLocation?.suburb || '',
      address_state: customerLocation?.state || '',
      address_place_id: customerLocation?.place_id || '',
    };
  };

  // Asked only while the Review step is showing. A quote that is slow, fails or says nothing leaves
  // this null, and Submit works exactly as before.
  const depositQuote = useDepositQuote(step === 5 && !submitted ? buildBookingFields() : null);

  const SUBMIT_TIMEOUT_MS = 12000;
  const handleSubmit = async () => {
    if (submittingRef.current) return; // duplicate submissions stay blocked
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setShowSlowNotice(false);

    // Everything below belongs to THIS session only.
    const seq = sessionSeqRef.current;
    const isCurrent = () => seq === sessionSeqRef.current;

    const slowTimer = setTimeout(() => { if (isCurrent()) setShowSlowNotice(true); }, 2500);
    submitTimersRef.current.push(slowTimer);

    const payload = { ...buildBookingFields(), submission_token: sessionTokenRef.current, messaging_consent: messagingConsent };

    // Capped, so a stalled call can never leave the button spinning.
    const attempt = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SUBMIT_TIMEOUT')), SUBMIT_TIMEOUT_MS);
      submitTimersRef.current.push(timer);
      base44.functions.invoke('submitPublicBooking', payload)
        .then(res => { clearTimeout(timer); setDeposit(res?.data?.deposit || null); resolve(res); })
        .catch(err => { clearTimeout(timer); reject(err); });
    });

    try {
      try {
        await attempt();
      } catch (first) {
        if (first?.message !== 'SUBMIT_TIMEOUT') throw first;
        if (!isCurrent()) return;
        // The request may already be saved — resending the same key returns it.
        await attempt();
      }
      clearSubmitTimers();
      if (!isCurrent()) return;
      setSubmitted(true);
    } catch (e) {
      clearSubmitTimers();
      if (!isCurrent()) return;
      setSubmitting(false);
      submittingRef.current = false;
      setShowSlowNotice(false);
      const serverMessage = e?.response?.data?.error || e?.response?.data?.details?.[0];
      setSubmitError(
        e?.message === 'SUBMIT_TIMEOUT'
          ? "We couldn't confirm your request just now. Please submit again — if it already went through, we'll pick up that request rather than create a duplicate."
          : (serverMessage || 'Something went wrong submitting your request. Please try again.')
      );
    }
  };

  const reset = () => {
    // A brand new booking session. Stale submission state (the in-flight guard,
    // pending timers, the previous session's key and its sequence) is discarded
    // BEFORE anything else, so the next Submit behaves exactly like the first one.
    startNewSession();
    setSubmitting(false);
    setStep(1); setServiceAreaId(null); setPriorityStatus('priority');
    setSelectedDate(null); setRange([9, 18]);
    setParticipants([{ id: 'p1', primary_service_id: null, addon_ids: [] }]); setCollapsedIds(new Set());
    setClientName(''); setPhone(''); setEmail(''); setNotes('');
    setSubmitted(false); setDeposit(null); setFieldErrors({}); setRegionNotice(null); setSubmitError(null); setShowSlowNotice(false);
    setEditModeFromReview(false); setEditingStep(null);
    setBookingMode('normal'); setAfterHoursMode(null); setAfterHoursSlot(null); setAfterOpen(false);
    setCustomerLocation(null);
  };

  // ── Confirmation Screen ──
  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <BookingHeader />
        <div className="max-w-md mx-auto px-5 pb-16 pt-6 space-y-6">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" strokeWidth={1.5} />
            </div>
            <h2 className="mt-5 font-heading text-[1.75rem] font-bold leading-tight tracking-tight text-foreground">
              Request submitted
            </h2>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              We&apos;ve got it. You&apos;ll hear from us by SMS.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">What happens next</p>
            <div className="space-y-3">
              {[
                { icon: Send, title: 'Request Received', text: 'Your booking request has been received.' },
                { icon: CalendarCheck, title: 'Booking Confirmed', text: "We'll confirm your booking if your barber can complete the service within your selected window." },
                { icon: MessageSquare, title: 'Arrival Time Sent', text: 'Your exact arrival time will be sent the day before your appointment.' },
              ].map(({ icon: Icon, title, text }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-0.5">{title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground pt-1 border-t border-border">You'll receive all updates via SMS.</p>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-amber-200">Keep your window free</p>
              <p className="mt-1 text-[13px] leading-relaxed text-amber-200/70">
                Please make sure you&apos;re available for the full window you selected.
              </p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Request Summary</p>
            </div>
            <div className="divide-y divide-border">
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Service Area</span>
                <span className="text-xs font-medium text-foreground">
                  {selectedArea ? selectedArea.name : 'Outside priority area'}
                </span>
              </div>
              <div className="flex justify-between items-start px-4 py-2.5">
                <span className="text-xs text-muted-foreground shrink-0">Service Address</span>
                <span className="text-xs font-medium text-foreground text-right max-w-[60%]">
                  {customerLocation?.formatted_address || '—'}
                </span>
              </div>
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Appointment Date</span>
                <span className="text-xs font-medium text-foreground">{formattedDate}</span>
              </div>
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Availability Window</span>
                <span className="text-xs font-medium text-foreground">{availabilityLabel}</span>
              </div>
              {bookingMode === 'after_hours' && afterHoursSlot && (
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-xs text-muted-foreground">After-Hours Slot</span>
                  <span className="text-xs font-medium text-foreground">{afterHoursSlot}{afterHoursMode === 'mobile_callout' ? ' · +$50' : ''}</span>
                </div>
              )}
              {participants.map((p, i) => {
                const pPrimary = services.find(s => s.id === p.primary_service_id)?.name || '—';
                const pAddons = p.addon_ids.map(id => addons.find(a => a.id === id)?.name).filter(Boolean);
                const pLabel = pAddons.length > 0 ? `${pPrimary} + ${pAddons.join(', ')}` : pPrimary;
                return (
                  <div key={p.id} className="flex justify-between items-start px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">Person {i + 1}</span>
                    <span className="text-xs font-medium text-foreground text-right max-w-[55%]">{pLabel}</span>
                  </div>
                );
              })}
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs text-muted-foreground">People</span>
                <span className="text-xs font-medium text-foreground">{peopleCount} {peopleCount === 1 ? 'person' : 'people'}{isGroupBooking ? ' · Group booking' : ''}</span>
              </div>
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Estimated Duration</span>
                <span className="text-xs font-medium text-foreground">{totalMins} mins</span>
              </div>
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs font-semibold text-foreground">Total</span>
                <span className="text-xs font-bold text-primary">${totalPrice}</span>
              </div>
              {deposit?.required && (
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-xs font-semibold text-foreground">Deposit required</span>
                  <span className="text-xs font-bold text-primary">${Number(deposit.amount).toFixed(2)}</span>
                </div>
              )}
            </div>
            {deposit?.required && (
              <p className="px-4 py-3 border-t border-border text-xs text-muted-foreground leading-relaxed">
                A deposit applies to this booking. We'll text you a secure payment link before your appointment — your booking is held until it's paid.
              </p>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl px-4 py-3.5">
            <p className="text-xs font-semibold text-foreground mb-0.5">Check on your booking any time</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The exact arrival time comes the day before. Until then you can look your booking up with your name and phone number.
            </p>
            <Link to="/status" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
              Check my booking
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="bg-card border border-border rounded-xl px-4 py-3.5">
            <p className="text-xs font-semibold text-foreground mb-0.5">Need to change something?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Reply to the SMS confirmation or contact us as soon as possible.</p>
          </div>

          <div className="space-y-2.5">
            <Link
              to="/"
              className="flex h-12 w-full items-center justify-center rounded-full bg-foreground text-[15px] font-semibold text-background transition-colors duration-500 hover:bg-foreground/90 active:scale-[0.98]"
            >
              Back to home
            </Link>
            <button
              type="button"
              onClick={reset}
              className="flex h-12 w-full items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.02] text-[15px] font-medium text-foreground transition-colors duration-500 hover:border-primary/30 hover:bg-white/[0.04]"
            >
              Book another appointment
            </button>
          </div>

          <LegalLinks className="border-t border-white/[0.06] pt-6 text-center" />
        </div>
      </div>
    );
  }

  // ── Main 5-step flow ──
  return (
    <div className="min-h-screen bg-background">
      <BookingHeader />
      {/* One column on phones. On a large screen the form keeps a comfortable
          reading width and the running summary sits beside it, rather than the
          whole page staying a phone-width ribbon in the middle of the monitor. */}
      <div className="mx-auto w-full max-w-md pb-16 pt-6 lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,38rem)_21rem] lg:items-start lg:justify-center lg:gap-14 lg:px-8 lg:pb-24 lg:pt-12">
        {/* px-5 stays at every width: the sticky bar inside Region uses -mx-5 to
            reach the column edge, and loses its alignment without it. */}
        <div className="px-5">
        <StepProgress currentStep={step} labels={STEP_LABELS} />

        {/* A step that fails to render shows a recoverable message instead of
            blanking the page, and resets when the customer moves to another step */}
        <BookingErrorBoundary key={step}>
        {step === 1 && (
          <RegionStep
            serviceAreas={serviceAreas}
            selectedAreaId={serviceAreaId}
            priorityStatus={priorityStatus}
            onSelectArea={handleSelectArea}
            onSelectOutside={handleSelectOutside}
            onContinue={handleRegionContinue}
            loading={loading}
            loadError={loadError}
            onRetry={reload}
            customerLocation={customerLocation}
            onCustomerLocationChange={setCustomerLocation}
            radiusSettings={groupDiscountSettings}
            serviceCoverage={serviceCoverage}
          />
        )}

        {step === 2 && (
          <ServicesStep
            participants={participants}
            collapsedIds={collapsedIds}
            services={services}
            addons={addons}
            groupDiscountSettings={groupDiscountSettings}
            onAddPerson={addPerson}
            onRemovePerson={removePerson}
            onSelectPrimary={selectPrimary}
            onToggleAddon={toggleAddon}
            onCollapsePerson={collapsePerson}
            onExpandPerson={expandPerson}
            onContinue={handleServicesContinue}
            loading={loading}
            peopleCount={peopleCount}
            isGroupBooking={isGroupBooking}
            allHavePrimary={allHavePrimary}
            primaryServiceCount={primaryServiceCount}
            addonCount={addonCount}
            subtotal={subtotal}
            totalMins={totalMins}
            totalSavings={totalSavings}
            totalPrice={totalPrice}
            maxGroupPeople={maxGroupPeople}
            atMaxPeople={atMaxPeople}
          />
        )}

        {step === 3 && (
          <AvailabilityStep
            selectedArea={selectedArea}
            serviceAreas={serviceAreas}
            barberHours={barberHours}
            dayConfig={dayConfig}
            allRequests={allRequests}
            daySummaries={daySummaries}
            maxBookingsPerDay={maxBookingsPerDay}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            range={range}
            onRangeChange={setRange}
            bookingMode={bookingMode}
            setBookingMode={setBookingMode}
            afterHoursMode={afterHoursMode}
            setAfterHoursMode={setAfterHoursMode}
            afterHoursSlot={afterHoursSlot}
            setAfterHoursSlot={setAfterHoursSlot}
            afterOpen={afterOpen}
            setAfterOpen={setAfterOpen}
            totalMins={totalMins}
            onContinue={handleAvailabilityContinue}
            onBack={() => handleStepBack(2)}
            customerLocation={customerLocation}
            loading={loading}
          />
        )}

        {step === 4 && (
          <DetailsStep
            fields={{ clientName, phone, email, notes, messagingConsent }}
            errors={fieldErrors}
            onChange={handleFieldChange}
            onContinue={handleDetailsContinue}
            onBack={() => handleStepBack(3)}
          />
        )}

        {step === 5 && (
          <ReviewStep
            selectedArea={selectedArea}
            priorityZones={priorityZones}
            priorityStatus={priorityStatus}
            personItems={personItems}
            participants={participants}
            selectedDay={selectedDay}
            formattedDate={formattedDate}
            availabilityLabel={availabilityLabel}
            bookingMode={bookingMode}
            afterHoursMode={afterHoursMode}
            afterHoursSlot={afterHoursSlot}
            clientName={clientName}
            phone={phone}
            email={email}
            address={customerLocation?.formatted_address || ''}
            notes={notes}
            subtotal={subtotal}
            totalSavings={totalSavings}
            totalPrice={totalPrice}
            totalMins={totalMins}
            peopleCount={peopleCount}
            isGroupBooking={isGroupBooking}
            primaryServiceCount={primaryServiceCount}
            addonCount={addonCount}
            onEditStep={handleEditStep}
            onUpdateContactDetails={handleUpdateContactDetails}
            onSubmit={handleSubmit}
            submitting={submitting}
            showSlowNotice={showSlowNotice}
            submitError={submitError}
            onBack={() => setStep(4)}
            regionNotice={regionNotice}
            depositQuote={depositQuote}
          />
        )}
        </BookingErrorBoundary>
        </div>

        <BookingSummary
          selectedArea={selectedArea}
          address={customerLocation?.formatted_address || ''}
          personItems={personItems}
          peopleCount={peopleCount}
          totalMins={totalMins}
          subtotal={subtotal}
          totalSavings={totalSavings}
          calloutFee={calloutFee}
          totalPrice={totalPrice}
          hasDate={!!selectedDate}
          formattedDate={formattedDate}
          availabilityLabel={availabilityLabel}
        />
      </div>

      <div className="mx-auto w-full max-w-md px-5 pb-10 lg:max-w-6xl lg:px-8">
        <LegalLinks className="border-t border-white/[0.06] pt-6" />
      </div>
    </div>
  );
}