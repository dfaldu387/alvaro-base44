import React from 'react';
import AddressAutocomplete from '@/components/booking/AddressAutocomplete';
import { MapPin } from 'lucide-react';

export const fieldClass = 'w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#7c3aed]/50';

/** A field's own error, said right under it. */
export function FieldError({ children }) {
  if (!children) return null;
  return <p className="text-[11px] font-medium leading-snug text-red-600">{children}</p>;
}

/**
 * The client details and the booking address.
 *
 * These are the booking's own contact details — correcting them here fixes this
 * booking and never rewrites the client's permanent profile, which is said plainly
 * under the fields so nobody assumes otherwise. The address has no free-text path:
 * it has to come from the verified suggestions, exactly as the public form requires.
 */
export default function BookingContactFields({ form, setField, location, setLocation, errors = {} }) {
  return (
    <div className="space-y-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Client</p>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-zinc-500">Name</label>
        <input
          className={fieldClass}
          value={form.clientName}
          onChange={e => setField('clientName', e.target.value)}
          placeholder="Client name"
        />
        <FieldError>{errors.clientName}</FieldError>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-zinc-500">Phone</label>
          <input
            className={fieldClass}
            value={form.phone}
            onChange={e => setField('phone', e.target.value)}
            placeholder="04XX XXX XXX"
          />
          <FieldError>{errors.phone}</FieldError>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-zinc-500">Email</label>
          <input
            className={fieldClass}
            value={form.email}
            onChange={e => setField('email', e.target.value)}
            placeholder="name@email.com"
          />
          <FieldError>{errors.email}</FieldError>
        </div>
      </div>

      <p className="rounded-lg bg-zinc-50 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-500">
        These details are saved on this booking only. The client&apos;s profile is left as it is.
      </p>

      <div className="space-y-1 pt-1">
        <label className="text-[11px] font-semibold text-zinc-500">Booking address</label>
        <AddressAutocomplete
          value={location.address}
          onChange={value => setLocation(prev => ({ ...prev, address: value, verified: false }))}
          onSelect={data => setLocation({
            address: data.formatted_address,
            lat: data.lat,
            lng: data.lng,
            postcode: data.postcode || '',
            suburb: data.suburb || '',
            state: data.state || '',
            place_id: data.place_id || '',
            verified: true,
          })}
          onInvalidate={() => setLocation(prev => ({ ...prev, verified: false }))}
          placeholder="Start typing the booking address"
        />
        <p className={`flex items-center gap-1 text-[11px] ${location.verified ? 'text-emerald-600' : 'text-zinc-500'}`}>
          <MapPin className="h-3 w-3 shrink-0" />
          {location.verified
            ? 'Address verified — saving keeps these coordinates and re-checks coverage.'
            : 'Pick an address from the suggestions. Until then the saved address is kept.'}
        </p>
        <FieldError>{errors.address}</FieldError>
      </div>
    </div>
  );
}