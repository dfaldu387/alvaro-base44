import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { updateBookingRequest } from '@/lib/requestAdmin';
import { applyManualPlacement } from '@/lib/manualPlacement';
import { estimateBooking } from '@/lib/bookingEstimate';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS, getMaxGroupBookingPeople } from '@/lib/groupPricing';
import BookingContactFields, { fieldClass } from '@/components/schedule/edit/BookingContactFields';
import BookingScheduleFields from '@/components/schedule/edit/BookingScheduleFields';
import BookingServicesEditor from '@/components/schedule/edit/BookingServicesEditor';

const OVERRIDE_CODES = ['AVAILABILITY_OVERRIDE_REQUIRED', 'BOOKING_WINDOW_OVERRIDE_REQUIRED', 'TRAVEL_OVERRIDE_REQUIRED'];

/** The booking's participants, however the record happens to store them. */
function seedParticipants(appt) {
  const stored = Array.isArray(appt?.participants) ? appt.participants : [];
  if (stored.length > 0) {
    return stored.map(p => ({
      primary_service: p.primary_service || '',
      addons: Array.isArray(p.addons) ? [...p.addons] : [],
    }));
  }
  const names = Array.isArray(appt?.services) ? appt.services : [];
  return [{ primary_service: names[0] || '', addons: names.slice(1) }];
}

const sameParticipants = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Edit Booking — one editor for the whole appointment, inside the drawer.
 *
 * Nothing here decides scheduling or money: the content is written by
 * updateBookingRequest (which recalculates duration, price and discount from the
 * catalogue, re-checks coverage and records the change), and the new time by
 * applyManualPlacement (which re-validates working hours, overlaps, travel and the
 * booking window immediately before saving). A refusal is shown against the field
 * it belongs to; a time that only breaks a soft rule is offered back as an explicit
 * override the administrator has to press.
 */
export default function BookingEditForm({ appt, onCancel, onSaved, onAddToast }) {
  const requestId = appt?.requestId;

  const [form, setForm] = useState(() => ({
    clientName: appt?.clientName || '',
    phone: appt?.phone || '',
    email: appt?.email || '',
    notes: appt?.notes || '',
    date: appt?.date || '',
    start: Number.isFinite(appt?.apptStart) ? appt.apptStart : null,
  }));
  const [location, setLocation] = useState(() => ({
    address: appt?.address || '',
    verified: false,
  }));
  const [participants, setParticipants] = useState(() => seedParticipants(appt));
  const seed = useMemo(() => seedParticipants(appt), [appt?.id]);
  const [catalogue, setCatalogue] = useState({ services: [], addons: [] });
  const [settings, setSettings] = useState(DEFAULT_GROUP_DISCOUNT_SETTINGS);
  const [errors, setErrors] = useState({});
  const [warning, setWarning] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Service.filter({ is_active: true }, 'sort_order', 200).catch(() => null),
      base44.entities.AddOn.filter({ is_active: true }, 'sort_order', 200).catch(() => null),
      base44.entities.GroupDiscountSettings.list('-created_date', 1).catch(() => null),
    ]).then(([serviceRows, addonRows, settingRows]) => {
      setCatalogue({
        services: (serviceRows?.items || serviceRows || []),
        addons: (addonRows?.items || addonRows || []),
      });
      const row = (settingRows?.items || settingRows || [])[0];
      if (row) setSettings({ ...DEFAULT_GROUP_DISCOUNT_SETTINGS, ...row });
    });
  }, []);

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const estimate = estimateBooking(participants, catalogue.services, catalogue.addons, settings);
  const maxPeople = getMaxGroupBookingPeople(settings);

  const validate = () => {
    const next = {};
    if (form.clientName.trim().length < 2) next.clientName = 'Enter the client’s full name.';
    if (form.phone.replace(/\D/g, '').length < 8) next.phone = 'Enter a valid phone number.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (location.address.trim() !== (appt?.address || '').trim() && !location.verified) {
      next.address = 'Pick the new address from the suggestions so it can be verified.';
    }
    if (!form.date) next.date = 'Choose a date.';
    if (!Number.isFinite(form.start)) next.start = 'Choose a start time.';
    participants.forEach((person, index) => {
      if (!person.primary_service) next[`person_${index}`] = 'Choose a service for this person.';
    });
    if (Object.keys(next).length > 0) next.form = 'Some details still need fixing.';
    return next;
  };

  const finish = (placement) => {
    onAddToast?.({
      message: 'Booking updated',
      description: placement?.assigned_time ? `Placed at ${placement.assigned_time}.` : undefined,
      type: 'success',
    });
    onSaved?.(placement || null);
  };

  const save = async (override = false) => {
    if (saving) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    setErrors({});
    setWarning(null);

    try {
      // ── 1. Everything the booking is made of ────────────────────────────────
      const payload = { booking_request_id: requestId };
      if (form.clientName.trim() !== (appt.clientName || '')) payload.client_name = form.clientName.trim();
      if (form.phone.trim() !== (appt.phone || '')) payload.phone = form.phone.trim();
      if (form.email.trim() !== (appt.email || '')) payload.email = form.email.trim();
      if (form.notes !== (appt.notes || '')) payload.notes = form.notes;
      if (!sameParticipants(participants, seed)) {
        payload.participants = participants.map(p => ({ primary_service: p.primary_service, addons: p.addons }));
      }
      if (location.verified) {
        payload.address = location.address;
        payload.address_lat = location.lat;
        payload.address_lng = location.lng;
        payload.address_postcode = location.postcode;
        payload.address_suburb = location.suburb;
        payload.address_state = location.state;
        payload.address_place_id = location.place_id;
      }
      const contentChanged = Object.keys(payload).length > 1;

      if (contentChanged) {
        const saved = await updateBookingRequest(payload);
        if (saved?.saved !== true) {
          const message = saved?.error || 'Those changes could not be saved.';
          setErrors(saved?.code === 'COVERAGE_RESTRICTION' ? { address: message, form: message } : { form: message });
          return;
        }
      }

      // ── 2. The time, only through the validator ─────────────────────────────
      const timeChanged = form.date !== (appt.date || '') || Math.abs(form.start - appt.apptStart) > 1e-6;
      if (!timeChanged && !override) {
        finish(null);
        return;
      }

      const placement = await applyManualPlacement({
        requestId,
        startDecimal: form.start,
        date: form.date,
        // The record was just rewritten, so the version the drawer holds is stale.
        expectedUpdatedDate: contentChanged ? null : appt.updatedDate || null,
        override,
        overrideTravel: warning?.code === 'TRAVEL_OVERRIDE_REQUIRED',
        overrideReason: override ? 'Edited in the booking drawer — authorised override' : null,
      });

      if (placement?.saved === true) {
        finish(placement);
        return;
      }

      if (OVERRIDE_CODES.includes(placement?.code)) {
        setWarning({
          code: placement.code,
          message: placement.message || 'This time needs your decision before it can be saved.',
          contentSaved: contentChanged,
        });
        if (contentChanged) onSaved?.(null);
        return;
      }

      setErrors({
        schedule: placement?.error || placement?.result?.violations?.[0]?.message || 'That time could not be validated.',
        form: contentChanged ? 'Your booking details were saved, but the new time was refused.' : undefined,
      });
      if (contentChanged) onSaved?.(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <BookingContactFields
          form={form}
          setField={setField}
          location={location}
          setLocation={setLocation}
          errors={errors}
        />

        <BookingScheduleFields
          date={form.date}
          start={form.start}
          onDate={value => setField('date', value)}
          onStart={value => setField('start', value)}
          durationMins={estimate.mins}
          errors={errors}
        />

        <BookingServicesEditor
          services={catalogue.services}
          addons={catalogue.addons}
          participants={participants}
          onChange={setParticipants}
          settings={settings}
          maxPeople={maxPeople}
          originalTotal={appt?.price ?? null}
          errors={errors}
        />

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Notes</label>
          <textarea
            value={form.notes}
            maxLength={2000}
            onChange={e => setField('notes', e.target.value)}
            rows={3}
            placeholder="Anything the barber should know"
            className={`${fieldClass} min-h-[84px] resize-none`}
          />
        </div>

        {errors.form && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-medium text-red-700">
            {errors.form}
          </p>
        )}
        {errors.schedule && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800">
            {errors.schedule}
          </p>
        )}

        {warning && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-amber-900">
                  {warning.code === 'TRAVEL_OVERRIDE_REQUIRED'
                    ? 'Travel time may not be achievable'
                    : warning.code === 'BOOKING_WINDOW_OVERRIDE_REQUIRED'
                      ? 'Outside the booking window'
                      : 'Outside the client’s availability'}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-amber-800">{warning.message}</p>
                {warning.contentSaved && (
                  <p className="mt-0.5 text-[11px] text-amber-700">Your other changes were saved.</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving}
              className="w-full rounded-lg bg-amber-600 py-2 text-[11px] font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              Save anyway
            </button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-zinc-200 px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 py-2.5 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        <button
          type="button"
          onClick={() => save(false)}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#7c3aed] py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#6d28d9] disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}