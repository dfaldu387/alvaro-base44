/**
 * CreateAppointmentSheet — the manual booking form, Square-style.
 *
 * One calm vertical form: Customer → Services → People → Date & time → Repeat →
 * Notes, with a live summary beside it and ONE way to finish: Save appointment.
 *
 * A booking is PEOPLE, not a flat list of unique services: each person has one
 * primary service and their own add-ons (see lib/bookingPeople). Two Haircuts is
 * two people; a Beard is an add-on on one of them and never a person.
 *
 * Two scheduling types, never a vague toggle:
 *   exact  — the time is agreed, so the booking is placed at that time (the shared
 *            validator still decides; a refusal keeps the booking as a request).
 *   window — the client is flexible, so the booking is saved with its availability
 *            window and Route Flow places it inside (never pinned to a guess).
 *
 * Everything shown here is a preview: the server reprices and re-times the booking
 * from the same catalogue on save, so a browser number can never become the truth.
 *
 * Repeat creates real occurrences (see lib/appointmentSeries) and records the series
 * in AppointmentSeries, so the group of bookings stays findable as one.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createAdminBooking, createAdminClients } from '@/lib/adminBookingApi';
import { applyManualPlacement } from '@/lib/manualPlacement';
import useSubmissionToken from '@/hooks/useSubmissionToken';
import { dateKey, fromDateKey } from '@/lib/dateScope';
import { decimalToLabel } from '@/lib/timeUtils';
import { occurrenceDates, frequencyLabel, endsLabel } from '@/lib/appointmentSeries';
import {
  newPerson, summarisePeople, participantsOf, addUnit, removeUnit,
} from '@/lib/bookingPeople';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS } from '@/lib/groupPricing';
import { toast } from '@/components/ui/use-toast';
import FormSection from '@/components/appointments/FormSection';
import CustomerField from '@/components/appointments/CustomerField';
import ServicesField from '@/components/appointments/ServicesField';
import PeopleField from '@/components/appointments/PeopleField';
import ScheduleField from '@/components/appointments/ScheduleField';
import RepeatField from '@/components/appointments/RepeatField';
import AppointmentSummary from '@/components/appointments/AppointmentSummary';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMPTY_CLIENT = { id: null, name: '', phone: '', email: '', address: '', record: null, isNew: false };

export default function CreateAppointmentSheet({
  onClose, onSaved, selectedDateKey, prefillTime, prefillDurationMins = null,
  staffMembers, defaultStaffId,
}) {
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [addonCatalogue, setAddonCatalogue] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_GROUP_DISCOUNT_SETTINGS);
  const [client, setClient] = useState(EMPTY_CLIENT);
  const [people, setPeople] = useState(() => [newPerson('')]);
  const [date, setDate] = useState(selectedDateKey || dateKey(new Date()));
  const [mode, setMode] = useState('exact');
  const [startTime, setStartTime] = useState(prefillTime ?? 9);
  const [windowStart, setWindowStart] = useState(prefillTime ?? 9);
  const [windowMinutes, setWindowMinutes] = useState(120);
  const [repeat, setRepeat] = useState({ enabled: false, everyWeeks: 1, ends: 'never', count: 4, untilDate: '' });
  const [notes, setNotes] = useState('');
  const [staffId, setStaffId] = useState(defaultStaffId || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submissionToken = useSubmissionToken();

  useEffect(() => {
    base44.entities.Service.list('sort_order', 50).then(rows => setServices(Array.isArray(rows) ? rows : [])).catch(() => {});
    base44.entities.AddOn.list('sort_order', 200).then(rows => setAddonCatalogue(Array.isArray(rows) ? rows : [])).catch(() => {});
    base44.entities.ReminderClient.list('-created_date', 500).then(rows => setClients(Array.isArray(rows) ? rows : [])).catch(() => {});
    base44.entities.GroupDiscountSettings.list('-created_date', 10)
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setSettings(list.find(r => !r.team_member_id) || list[0] || DEFAULT_GROUP_DISCOUNT_SETTINGS);
      })
      .catch(() => {});
  }, []);

  // The barber defaults to the calendar's filter, then to the first bookable one.
  useEffect(() => {
    if (staffId) return;
    const first = (staffMembers || []).find(m => m.status === 'Active' && m.is_bookable);
    if (first) setStaffId(first.id);
  }, [staffMembers, staffId]);

  const summary = useMemo(
    () => summarisePeople(people, services, addonCatalogue, settings),
    [people, services, addonCatalogue, settings],
  );
  const durationMins = summary.durationMins;
  // A dragged range is only ever an opening preview; the catalogue sets the real length.
  const draggedMins = durationMins === 0 && Number(prefillDurationMins) > 0 ? Number(prefillDurationMins) : null;
  const windowEnd = windowStart + windowMinutes / 60;

  const dates = useMemo(() => (repeat.enabled
    ? occurrenceDates({ startDate: date, everyWeeks: repeat.everyWeeks, ends: repeat.ends, count: repeat.count, untilDate: repeat.untilDate })
    : [date]), [date, repeat]);

  const setClientField = (patch) => setClient(prev => ({ ...prev, ...patch }));

  const addServiceUnit = (name) => setPeople(prev => {
    // A blank person waiting for a service is filled first, so choosing a service never
    // leaves an empty person behind.
    const blank = prev.findIndex(p => !p.primary);
    if (blank >= 0) return prev.map((p, i) => (i === blank ? { ...p, primary: name } : p));
    return addUnit(prev, name);
  });
  const removeServiceUnit = (name) => setPeople(prev => removeUnit(prev, name));
  const addPerson = () => setPeople(prev => {
    if (prev.some(p => !p.primary)) return prev;
    return [...prev, newPerson(prev[prev.length - 1]?.primary || '')];
  });
  const changePerson = (key, patch) => setPeople(prev => prev.map(p => (p.key === key ? { ...p, ...patch } : p)));
  const removePerson = (key) => setPeople(prev => (prev.length > 1 ? prev.filter(p => p.key !== key) : prev));

  const validate = () => {
    if (!client.name.trim()) return 'Choose a client, or enter their name.';
    if ((client.phone || '').replace(/\D/g, '').length < 8) return 'A phone number is required.';
    if (!client.address.trim()) return 'A service address is required.';
    if (summary.peopleCount === 0) return 'Choose a service for at least one person.';
    if (people.some(p => !p.primary)) return 'Every person needs a main service.';
    if (summary.overMax) return `Maximum ${summary.maxPeople} people per booking. Split this group into two bookings.`;
    if (!date) return 'Choose a date.';
    if (mode === 'window' && windowMinutes < durationMins) return 'The availability window is shorter than the appointment.';
    if (repeat.enabled && repeat.ends === 'on' && !repeat.untilDate) return 'Choose the date the repeat ends.';
    return null;
  };

  // A new client becomes a real record here, at save time, so an abandoned form
  // never leaves a stray client behind.
  const ensureClientId = async () => {
    if (client.id) return client.id;
    const { created: [record] } = await createAdminClients([{
      client_name: client.name.trim(),
      phone: client.phone || undefined,
      email: client.email || undefined,
      address: client.address || undefined,
      frequency: 'Monthly',
      cadence_source: 'default',
      client_type: 'New',
      source: 'Manual',
      workflow_stage: 'none',
    }]);
    setClient(prev => ({ ...prev, id: record.id, record }));
    return record.id;
  };

  const windowLabel = () => (mode === 'exact'
    ? `${decimalToLabel(startTime)}–${decimalToLabel(startTime + durationMins / 60)}`
    : `${decimalToLabel(windowStart)}–${decimalToLabel(windowEnd)}`);

  const bookingFields = (clientId, isoDate) => ({
    client_id: clientId || undefined,
    client_name: client.name.trim(),
    phone: client.phone,
    email: client.email || undefined,
    address: client.address || undefined,
    day: DAY_NAMES[fromDateKey(isoDate).getDay()],
    requested_date: isoDate,
    availability_window: windowLabel(),
    // A person per participant, each with their own add-ons: the server prices and
    // times exactly this list, and never the numbers shown on this screen.
    participants: participantsOf(people),
    notes: notes || undefined,
    team_member_id: staffId || undefined,
  });

  const save = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const clientId = await ensureClientId();
      const series = repeat.enabled
        ? await base44.entities.AppointmentSeries.create({
          client_id: clientId || undefined,
          client_name: client.name.trim(),
          team_member_id: staffId || undefined,
          team_member_name: staffMembers?.find(m => m.id === staffId)?.name,
          scheduling_type: mode,
          availability_window: windowLabel(),
          services: people.flatMap(p => [p.primary, ...(p.addons || [])]).filter(Boolean),
          duration_mins: durationMins,
          frequency_weeks: repeat.everyWeeks,
          frequency_label: frequencyLabel(repeat.everyWeeks),
          ends: repeat.ends,
          ends_label: endsLabel(repeat),
          until_date: repeat.ends === 'on' ? repeat.untilDate : undefined,
          first_date: date,
          notes: notes || undefined,
        })
        : null;

      const createdIds = [];
      let placed = 0;
      let refusal = '';

      for (let index = 0; index < dates.length; index += 1) {
        const isoDate = dates[index];
        const day = DAY_NAMES[fromDateKey(isoDate).getDay()];
        // One token per occurrence: a retry of THIS save never makes a duplicate.
        const req = await createAdminBooking(`${submissionToken}-${index}`, bookingFields(clientId, isoDate), {
          onCapacity: reason => toast({ title: 'Saved. That day is already full.', description: reason }),
        });
        createdIds.push(req.id);

        if (mode === 'exact') {
          // The agreed time is placed through the shared validator — never written here.
          const res = await applyManualPlacement({
            requestId: req.id,
            startDecimal: startTime,
            date: isoDate,
            day,
            barberId: staffId || null,
            expectedUpdatedDate: req.updated_date || null,
            confirmRequest: true,
            note: 'Created in the appointment form',
          });
          if (res?.saved === true) placed += 1;
          else if (!refusal) refusal = res?.error || res?.message || 'The schedule check refused that time.';
        }
      }

      if (series) {
        await base44.entities.AppointmentSeries.update(series.id, {
          booking_request_ids: createdIds,
          occurrences_created: createdIds.length,
        });
      }

      onSaved?.({
        mode,
        total: dates.length,
        placed,
        unplaced: mode === 'exact' ? dates.length - placed : dates.length,
        refusal,
      });
    } catch (e) {
      setError(e?.message || 'The appointment could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header — the one place the appointment is saved */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-500">Appointments</p>
            <h1 className="truncate text-base font-semibold text-zinc-900">Create appointment</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : 'Save appointment'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 md:grid-cols-[minmax(0,1fr)_320px] md:px-8">

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {error && (
              <div className="flex items-start gap-2 border-b border-red-100 bg-red-50 px-6 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-xs font-medium text-red-700">{error}</p>
              </div>
            )}

            <FormSection title="Customer">
              <CustomerField client={client} onChange={setClientField} clients={clients} />
            </FormSection>

            <FormSection title="Services" hint="Price and duration come from your catalogue">
              <ServicesField
                services={services}
                people={people}
                onAddUnit={addServiceUnit}
                onRemoveUnit={removeServiceUnit}
              />
            </FormSection>

            <FormSection title="People" hint="One service each · add-ons stay with their person">
              <PeopleField
                people={people}
                services={services}
                addonCatalogue={addonCatalogue}
                settings={settings}
                onChangePerson={changePerson}
                onRemovePerson={removePerson}
                onAddPerson={addPerson}
              />
            </FormSection>

            <FormSection title="Date & time">
              <ScheduleField
                mode={mode} setMode={setMode}
                date={date} setDate={setDate}
                startTime={startTime} setStartTime={setStartTime}
                windowStart={windowStart} setWindowStart={setWindowStart}
                windowMinutes={windowMinutes} setWindowMinutes={setWindowMinutes}
                windowEnd={windowEnd}
                staffId={staffId} setStaffId={setStaffId} staffMembers={staffMembers}
                serviceMins={durationMins}
                draggedMins={draggedMins}
              />
            </FormSection>

            <FormSection title="Repeat">
              <RepeatField repeat={repeat} setRepeat={setRepeat} mode={mode} occurrenceCount={dates.length} />
            </FormSection>

            <FormSection title="Notes" hint="Optional">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Parking details, gate code, special requests..."
                className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </FormSection>
          </div>

          <aside className="md:sticky md:top-6 md:self-start">
            <AppointmentSummary
              client={client}
              people={summary.rows}
              peopleCount={summary.peopleCount}
              subtotal={summary.subtotal}
              discount={summary.discount}
              total={summary.total}
              durationMins={durationMins}
              addonMins={summary.addonMins}
              date={date}
              mode={mode}
              startTime={startTime}
              windowStart={windowStart}
              windowEnd={windowEnd}
              repeat={repeat}
              occurrenceCount={dates.length}
            />
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-zinc-500">
              {mode === 'exact'
                ? 'The exact time is checked against working hours, buffers, travel and other appointments before it is placed.'
                : 'Route Flow places each appointment inside the availability window on the day.'}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}