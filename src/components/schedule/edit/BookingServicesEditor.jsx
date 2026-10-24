import React from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { lineForPerson, estimateBooking } from '@/lib/bookingEstimate';
import { FieldError } from '@/components/schedule/edit/BookingContactFields';

const control = 'w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-[#7c3aed]/50';

/**
 * Services, one participant at a time.
 *
 * Each person has exactly ONE primary service plus any add-ons — several services
 * are never turned into several people. Group bookings keep every participant
 * separate here, and the group discount is worked out from the number of people,
 * never from the number of services. Prices and durations shown are an estimate;
 * the server recalculates both from the catalogue when the edit is saved.
 */
export default function BookingServicesEditor({
  services = [], addons = [], participants = [], onChange, settings = null, maxPeople = 6,
  originalTotal = null, errors = {},
}) {
  const { total, subtotal, discount, tier } = estimateBooking(participants, services, addons, settings);

  const setPerson = (index, changes) => {
    onChange(participants.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  };
  const toggleAddon = (index, name) => {
    onChange(participants.map((p, i) => {
      if (i !== index) return p;
      const has = (p.addons || []).includes(name);
      return { ...p, addons: has ? p.addons.filter(a => a !== name) : [...(p.addons || []), name] };
    }));
  };
  const addPerson = () => onChange([...participants, { primary_service: '', addons: [] }]);
  const removePerson = (index) => onChange(participants.filter((_, i) => i !== index));

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Services</p>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-500">
          <Users className="h-3 w-3" />{participants.length} {participants.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      {participants.map((person, index) => {
        const line = lineForPerson(person, services, addons);
        const lineError = errors[`person_${index}`];
        return (
          <div key={index} className="space-y-2 rounded-xl border border-zinc-200 bg-white p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-500">Person {index + 1}</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {line.mins > 0 ? `${line.mins} min` : '—'}{line.price > 0 ? ` · $${line.price.toFixed(2)}` : ''}
                </span>
                {participants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePerson(index)}
                    title="Remove this person"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <select
              value={person.primary_service || ''}
              onChange={e => setPerson(index, { primary_service: e.target.value })}
              className={control}
            >
              <option value="">Select a service…</option>
              {services.map(service => (
                <option key={service.id} value={service.name}>
                  {service.name} · {service.duration_mins || 0} min
                  {service.price ? ` · $${Number(service.price).toFixed(2)}` : ''}
                </option>
              ))}
            </select>
            <FieldError>{lineError}</FieldError>

            {addons.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {addons.map(addon => {
                  const selected = (person.addons || []).includes(addon.name);
                  return (
                    <button
                      key={addon.id}
                      type="button"
                      onClick={() => toggleAddon(index, addon.name)}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                        selected
                          ? 'border-[#7c3aed]/40 bg-[#f3efff] text-[#6d28d9]'
                          : 'border-zinc-200 bg-white text-zinc-500 hover:border-[#7c3aed]/30'
                      }`}
                    >
                      {addon.name}{addon.duration_adjustment ? ` · +${addon.duration_adjustment}m` : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {participants.length < maxPeople && (
        <button
          type="button"
          onClick={addPerson}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[#6d28d9] hover:text-[#5b21b6]"
        >
          <Plus className="h-3 w-3" /> Add another person
        </button>
      )}
      <FieldError>{errors.participants}</FieldError>

      <div className="space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>Subtotal</span>
          <span className="tabular-nums">${subtotal.toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div className="flex items-center justify-between text-[11px] text-emerald-700">
            <span>
              Group discount{tier?.tier ? ` (${tier.tier} people)` : ''}
              {tier?.type === 'percentage' ? ` · ${tier.amount}%` : ''}
            </span>
            <span className="tabular-nums">−${discount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-zinc-200 pt-1">
          <span className="text-xs font-bold text-zinc-700">Total</span>
          <span className="flex items-baseline gap-1.5">
            {originalTotal != null && Math.abs(originalTotal - total) > 0.004 && (
              <span className="text-[11px] tabular-nums text-zinc-400 line-through">${Number(originalTotal).toFixed(2)}</span>
            )}
            <span className="text-sm font-bold tabular-nums text-zinc-900">${total.toFixed(2)}</span>
          </span>
        </div>
        <p className="pt-0.5 text-[10px] leading-snug text-zinc-400">
          Estimate only — the server recalculates duration, price and discount when you save.
        </p>
      </div>

    </div>
  );
}