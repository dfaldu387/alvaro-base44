import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Save, AlertTriangle, CheckCircle2, Plus, Trash2, MapPin } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import AddressAutocomplete from '@/components/booking/AddressAutocomplete';
import { updateBookingRequest } from '@/lib/requestAdmin';

const inputClass = 'w-full bg-white text-zinc-900 border border-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 placeholder:text-zinc-400';

/**
 * Edit a booking request.
 *
 * Corrects the availability window, the service and add-ons, the service address,
 * the contact details and the notes. Everything that follows from those is
 * recalculated server-side from the catalogue and the coverage configuration, and
 * Route Flow immediately re-runs on the edited request — the admin never triggers
 * it. The request stays visible throughout: it is never removed from the queue by
 * an edit.
 */
export default function EditRequestModal({ request, onClose, onDone }) {
  const [form, setForm] = useState({
    client_name: request.client_name || '',
    phone: request.phone || '',
    email: request.email || '',
    notes: request.notes || '',
    availability_window: request.availability_window || '',
  });
  const [location, setLocation] = useState({
    address: request.address || '',
    lat: request.address_lat,
    lng: request.address_lng,
    postcode: request.address_postcode || '',
    suburb: request.address_suburb || '',
    state: request.address_state || '',
    place_id: request.address_place_id || '',
    verified: request.address_lat != null && request.address_lng != null,
  });
  const [participants, setParticipants] = useState(() => {
    const stored = Array.isArray(request.participants) ? request.participants : [];
    if (stored.length > 0) {
      return stored.map(p => ({ primary: p.primary_service || '', addons: Array.isArray(p.addons) ? p.addons : [] }));
    }
    const names = Array.isArray(request.services) ? request.services : [];
    return [{ primary: names[0] || '', addons: names.slice(1) }];
  });
  const [catalogue, setCatalogue] = useState({ services: [], addons: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    Promise.all([
      base44.entities.Service.filter({ is_active: true }, 'sort_order', 200).catch(() => ({ items: [] })),
      base44.entities.AddOn.filter({ is_active: true }, 'sort_order', 200).catch(() => ({ items: [] })),
    ]).then(([s, a]) => setCatalogue({ services: s?.items || [], addons: a?.items || [] }));
  }, []);

  const isAfterHours = !!(request.after_hours_mode && request.after_hours_slot);

  // Local feedback only — the backend recalculates and is authoritative.
  const totals = useMemo(() => {
    let price = 0;
    let mins = 0;
    for (const person of participants) {
      const primary = catalogue.services.find(s => s.name === person.primary);
      if (primary) { price += primary.price || 0; mins += primary.duration_mins || 0; }
      for (const addonName of person.addons) {
        const addon = catalogue.addons.find(a => a.name === addonName);
        if (addon) { price += addon.price_adjustment || 0; mins += addon.duration_adjustment || 0; }
      }
    }
    return { price: Math.round(price * 100) / 100, mins };
  }, [participants, catalogue]);

  const setPerson = (index, changes) => setParticipants(prev =>
    prev.map((p, i) => (i === index ? { ...p, ...changes } : p))
  );

  const toggleAddon = (index, addonName) => setParticipants(prev => prev.map((p, i) => {
    if (i !== index) return p;
    const has = p.addons.includes(addonName);
    return { ...p, addons: has ? p.addons.filter(a => a !== addonName) : [...p.addons, addonName] };
  }));

  const save = async () => {
    setSaving(true);
    setError('');
    setOutcome(null);

    const payload = {
      booking_request_id: request.id,
      client_name: form.client_name,
      phone: form.phone,
      email: form.email,
      notes: form.notes,
      participants: participants.map(p => ({ primary_service: p.primary, addons: p.addons })),
    };
    if (!isAfterHours) payload.availability_window = form.availability_window;
    // Only sent when an address was actually picked, so an untouched address is
    // never re-geocoded or cleared.
    if (location.verified) {
      payload.address = location.address;
      payload.address_lat = location.lat;
      payload.address_lng = location.lng;
      payload.address_postcode = location.postcode || '';
      payload.address_suburb = location.suburb || '';
      payload.address_state = location.state || '';
      payload.address_place_id = location.place_id || '';
    }

    const data = await updateBookingRequest(payload);
    setSaving(false);
    if (!data || data.saved !== true) {
      setError(data?.error || 'Those changes could not be saved. Please try again.');
      return;
    }
    setOutcome(data);
    onDone?.(data);
  };

  const routeFlow = outcome?.route_flow;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl border border-zinc-200 shadow-xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-zinc-900">Edit request</h2>
            <p className="text-xs text-zinc-500">{request.client_name} · {request.requested_date || request.day}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Route Flow's verdict after an edit — it re-ran by itself */}
          {outcome && (
            <div className={`rounded-xl border px-3 py-2.5 flex items-start gap-2 ${
              routeFlow?.placed ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
            }`}>
              {routeFlow?.placed
                ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
              <div>
                <p className={`text-xs font-semibold ${routeFlow?.placed ? 'text-green-800' : 'text-amber-800'}`}>
                  {routeFlow?.placed
                    ? `Saved — Route Flow placed it provisionally at ${routeFlow.assigned_time}`
                    : 'Saved — Route Flow still has no valid slot for this request'}
                </p>
                {!routeFlow?.placed && (
                  <p className="text-xs text-amber-700 mt-0.5">
                    {routeFlow?.message || 'It stays in Needs Action with its updated reason.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Contact details */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Contact details</p>
            <input
              value={form.client_name}
              onChange={e => setForm({ ...form, client_name: e.target.value })}
              placeholder="Client name"
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone"
                className={inputClass}
              />
              <input
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="Email"
                className={inputClass}
              />
            </div>
          </div>

          {/* Availability window */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Availability window</p>
            {isAfterHours ? (
              <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-600">
                After-hours booking — the window is the slot the customer agreed to ({request.after_hours_slot}).
              </div>
            ) : (
              <>
                <input
                  value={form.availability_window}
                  onChange={e => setForm({ ...form, availability_window: e.target.value })}
                  placeholder="e.g. 9am–2pm, 2pm–7pm, or Flexible"
                  className={inputClass}
                />
                <p className="text-[11px] text-zinc-500">
                  Route Flow places the appointment inside this window, so it has to be readable.
                </p>
              </>
            )}
          </div>

          {/* Service address */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Service address</p>
            <AddressAutocomplete
              value={location.address}
              onChange={value => setLocation(prev => ({ ...prev, address: value, verified: false }))}
              onSelect={data => setLocation({
                address: data.formatted_address,
                lat: data.lat,
                lng: data.lng,
                postcode: data.postcode,
                suburb: data.suburb,
                state: data.state,
                place_id: data.place_id,
                verified: true,
              })}
              onInvalidate={() => setLocation(prev => ({ ...prev, verified: false }))}
              placeholder="Start typing the service address"
            />
            <p className={`text-[11px] flex items-center gap-1 ${location.verified ? 'text-green-600' : 'text-amber-600'}`}>
              <MapPin className="w-3 h-3" />
              {location.verified
                ? 'Location verified — saving keeps these coordinates'
                : 'Pick an address from the suggestions to update it (otherwise the saved address is kept)'}
            </p>
          </div>

          {/* Services and add-ons */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Services &amp; add-ons</p>
            {participants.map((person, index) => (
              <div key={index} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-500">Person {index + 1}</span>
                  {participants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setParticipants(prev => prev.filter((_, i) => i !== index))}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-3 h-3" />Remove
                    </button>
                  )}
                </div>
                <select
                  value={person.primary}
                  onChange={e => setPerson(index, { primary: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select a service…</option>
                  {catalogue.services.map(service => (
                    <option key={service.id} value={service.name}>
                      {service.name} · {service.duration_mins} min
                    </option>
                  ))}
                </select>
                {catalogue.addons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {catalogue.addons.map(addon => {
                      const selected = person.addons.includes(addon.name);
                      return (
                        <button
                          key={addon.id}
                          type="button"
                          onClick={() => toggleAddon(index, addon.name)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all ${
                            selected
                              ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                              : 'border-zinc-200 bg-white text-zinc-500 hover:border-indigo-300'
                          }`}
                        >
                          {addon.name}{addon.duration_adjustment ? ` · +${addon.duration_adjustment}m` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setParticipants(prev => [...prev, { primary: '', addons: [] }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                <Plus className="w-3 h-3" />Add another person
              </button>
              <span className="text-xs text-zinc-500">{totals.mins} min · ${totals.price}</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Notes</p>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Anything the barber should know"
              className={`${inputClass} resize-none`}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-zinc-200 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
          >
            {outcome ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}