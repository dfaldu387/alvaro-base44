import React from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { money, serviceDuration } from '@/lib/appointmentForm';
import { activeServices, addonsForService, pricePerson } from '@/lib/bookingPeople';

/**
 * One person on the booking: one primary service, and any add-ons that person is
 * having. Add-ons here never create another person — they only add time and price
 * to this one.
 */
export default function PersonCard({
  person, index, services, addonCatalogue, onChange, onRemove, canRemove,
}) {
  const services_ = activeServices(services);
  const service = services_.find(s => s.name === person.primary) || null;
  const available = addonsForService(addonCatalogue, service);
  const own = pricePerson(person, services, addonCatalogue);

  const toggleAddon = (name) => {
    const has = person.addons.includes(name);
    onChange({ addons: has ? person.addons.filter(a => a !== name) : [...person.addons, name] });
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Person {index + 1}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-zinc-900">
            {service ? money(own.price) : '—'}
            {service && <span className="ml-1 font-normal text-zinc-500">{serviceDuration(own.mins)}</span>}
          </span>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove person ${index + 1}`}
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <select
        value={person.primary}
        onChange={e => onChange({ primary: e.target.value, addons: [] })}
        className="mt-2 w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      >
        <option value="">Choose a service</option>
        {services_.map(svc => (
          <option key={svc.id} value={svc.name}>
            {svc.name} · {serviceDuration(svc.duration_mins)} · {money(svc.price)}
          </option>
        ))}
      </select>

      {service && available.length > 0 && (
        <div className="mt-2">
          <p className="mb-1.5 text-[11px] text-zinc-500">Add-ons</p>
          <div className="flex flex-wrap gap-1.5">
            {available.map(addon => {
              const chosen = person.addons.includes(addon.name);
              return (
                <button
                  key={addon.id}
                  type="button"
                  onClick={() => toggleAddon(addon.name)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    chosen
                      ? 'border-violet-300 bg-violet-50 font-semibold text-violet-800'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-violet-200 hover:bg-violet-50/40',
                  )}
                >
                  {addon.name}
                  <span className="text-[10px] tabular-nums opacity-70">
                    {Number(addon.price_adjustment) ? `+${money(addon.price_adjustment)}` : ''}
                    {Number(addon.price_adjustment) && Number(addon.duration_adjustment) ? ' · ' : ''}
                    {Number(addon.duration_adjustment) ? `+${addon.duration_adjustment} min` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}