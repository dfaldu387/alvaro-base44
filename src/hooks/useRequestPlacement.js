import { useCallback, useEffect, useRef, useState } from 'react';
import { applyManualPlacement } from '@/lib/manualPlacement';
import { placementRefusalMessage } from '@/lib/placementValidation';

/**
 * Dragging a booking request out of the side panel and onto the calendar.
 *
 * The hook owns the drag itself and the two decisions around it:
 *
 *   the drop      — where the pointer is comes from the calendar (WeekGrid owns the
 *                   pixel scale and reports the candidate time), and whether that time
 *                   is allowed is decided by the backend. Nothing is written until it
 *                   accepts, so a refused drop leaves the day exactly as it was.
 *   availability  — a preference, never a lock. When it is the only thing in the way
 *                   the backend answers AVAILABILITY_OVERRIDE_REQUIRED, the drop is
 *                   accepted straight away, and the client is texted to confirm the
 *                   new time (the barber is told, never asked).
 *   travel        — genuinely undecidable by rule, so the shortfall is put to the
 *                   barber, who may place anyway and have it audited.
 *
 * Refs, not state, carry the live drag: pointerup can land in the same tick as the last
 * pointermove, and it must read the newest time, not the one React last rendered.
 */
const DRAG_SLOP_PX = 6;

export default function useRequestPlacement({ bufferFor, onPlaced, onOverridePlaced, onTravelRequired, notify }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [overridePrompt, setOverridePrompt] = useState(null);
  const [overrideBusy, setOverrideBusy] = useState(false);

  const placementRef = useRef(null);
  const pendingRef = useRef(null);
  const commitRef = useRef(null);

  const setBoth = useCallback((next) => {
    placementRef.current = next;
    setPlacement(next);
  }, []);

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => {
    setOpen(false);
    pendingRef.current = null;
    setBoth(null);
    setGhost(null);
    setOverridePrompt(null);
  }, [setBoth]);

  // A press on a card is only a drag once the pointer has actually moved; a plain
  // click on the card must not fling it at the calendar.
  const beginPlacement = useCallback((request, e) => {
    if (!request) return;
    pendingRef.current = { request, x: e.clientX, y: e.clientY };
  }, []);

  // Where the calendar says the pointer is, and what it makes of that time.
  const applyHover = useCallback((hover) => {
    const prev = placementRef.current;
    if (!prev) return;
    const a = prev.hover;
    if (!a && !hover) return;
    if (a && hover && a.startDecimal === hover.startDecimal && a.state === hover.state
      && a.dateKey === hover.dateKey && a.index === hover.index && a.reason === hover.reason) return;
    setBoth({ ...prev, hover: hover || null });
  }, [setBoth]);

  const commitPlacement = useCallback(async (current, options = {}) => {
    const request = current?.request;
    const hover = current?.hover;
    setBoth(null);
    setGhost(null);
    setOverridePrompt(null);

    // Released away from the calendar: the drag is abandoned and nothing is sent.
    if (!request || (!hover && options.startDecimal == null)) return;

    const startDecimal = options.startDecimal ?? hover.startDecimal;
    const date = options.date || hover.dateKey;
    const day = options.dayName || hover.dayName;

    if (options.override) setOverrideBusy(true); else setBusyId(request.id);
    try {
      const data = await applyManualPlacement({
        requestId: request.id,
        startDecimal,
        date,
        day,
        barberId: request.team_member_id || null,
        expectedUpdatedDate: request.updated_date || null,
        override: options.override === true,
        overrideTravel: options.overrideTravel === true,
        overrideReason: options.overrideReason || null,
        confirmRequest: true,
      });

      if (data?.saved === true) {
        const awaiting = data.override_status === 'awaiting_confirmation';
        notify({
          message: awaiting ? 'Placed — the client is being asked to confirm' : 'Placed on the calendar',
          description: `${request.client_name} is now at ${data.assigned_time || startDecimal}.`,
          type: 'success',
        });
        if (awaiting) {
          onOverridePlaced?.({
            request,
            time: data.assigned_time || null,
            windowRaw: request.availability_window || null,
          });
        }
        onPlaced?.();
        return;
      }

      // Preferred availability is the only obstacle: the drop stands, and the client
      // is asked to confirm the offered time. The barber is told, never asked.
      if (data?.code === 'AVAILABILITY_OVERRIDE_REQUIRED' && data?.can_override === true) {
        await commitRef.current({ request }, {
          startDecimal: data.proposed_start_decimal ?? startDecimal,
          date,
          dayName: day,
          override: true,
          overrideReason: 'Placed outside preferred availability — confirmation requested',
        });
        return;
      }

      // Travel that cannot be achieved: the barber's call, so nothing is written yet.
      if (data?.code === 'TRAVEL_OVERRIDE_REQUIRED' && data?.can_override === true) {
        onTravelRequired?.({
          request,
          startDecimal: data.proposed_start_decimal ?? startDecimal,
          date,
          dayName: day,
          result: data.result,
        });
        return;
      }

      // The Booking Window is a hard setting, so it is still asked for explicitly.
      if (data?.code === 'BOOKING_WINDOW_OVERRIDE_REQUIRED' && data?.can_override === true) {
        setOverridePrompt({
          kind: 'window',
          request,
          startDecimal: data.proposed_start_decimal ?? startDecimal,
          date,
          dayName: day,
          durationMins: request.duration_mins,
          windowRaw: data.window_raw || request.availability_window,
          message: data.message,
        });
        return;
      }

      // Refused for a real reason (overlap, closure, coverage…), and the day is untouched.
      notify({
        message: 'Could not place that request',
        description: placementRefusalMessage(data)
          || 'The scheduling engine refused this placement.',
        type: 'error',
      });
    } finally {
      setBusyId(null);
      setOverrideBusy(false);
    }
  }, [notify, onPlaced, onOverridePlaced, onTravelRequired, setBoth]);

  /**
   * Place anyway, from the travel warning: the one decision the barber makes
   * explicitly, sent as an authorised override so it is recorded with its reason.
   */
  const placeAnyway = useCallback((spec) => {
    if (!spec?.request) return undefined;
    return commitRef.current({ request: spec.request }, {
      startDecimal: spec.startDecimal,
      date: spec.date,
      dayName: spec.dayName,
      override: true,
      overrideTravel: true,
      overrideReason: 'Travel time may not be achievable — placed anyway',
    });
  }, []);

  commitRef.current = commitPlacement;

  useEffect(() => {
    const onMove = (e) => {
      const pending = pendingRef.current;
      if (pending && !placementRef.current) {
        if (Math.abs(e.clientX - pending.x) < DRAG_SLOP_PX && Math.abs(e.clientY - pending.y) < DRAG_SLOP_PX) return;
        pendingRef.current = null;
        setGhost({ x: e.clientX, y: e.clientY });
        setBoth({ request: pending.request, bufferMins: bufferFor(pending.request), hover: null });
        return;
      }
      if (placementRef.current) setGhost({ x: e.clientX, y: e.clientY });
    };
    const onStop = () => {
      pendingRef.current = null;
      const current = placementRef.current;
      if (!current) return;
      commitRef.current?.(current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onStop);
    window.addEventListener('pointercancel', onStop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onStop);
      window.removeEventListener('pointercancel', onStop);
    };
  }, [bufferFor, setBoth]);

  const cancelOverride = useCallback(() => setOverridePrompt(null), []);

  const confirmOverride = useCallback(() => {
    const prompt = overridePrompt;
    if (!prompt) return;
    commitPlacement(
      { request: prompt.request, hover: { startDecimal: prompt.startDecimal, dateKey: prompt.date, dayName: prompt.dayName } },
      { override: true, overrideReason: 'Schedule Anyway — outside the booking window' },
    );
  }, [overridePrompt, commitPlacement]);

  return {
    open, openPanel, closePanel,
    placement, ghost, busyId,
    overridePrompt, overrideBusy, cancelOverride, confirmOverride,
    placeAnyway,
    beginPlacement, applyHover,
  };
}