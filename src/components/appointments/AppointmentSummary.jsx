import React from 'react';
import { format } from 'date-fns';
import { fromDateKey } from '@/lib/dateScope';
import { money, rangeLabel, serviceDuration } from '@/lib/appointmentForm';
import { endsLabel, frequencyLabel } from '@/lib/appointmentSeries';

function dateLabel(key) {
  const d = key ? fromDateKey(key) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, 'EEE, d MMM yyyy') : '—';
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="min-w-0 text-right text-xs font-medium text-zinc-900">{children}</span>
    </div>
  );
}

/** The right-hand column: who it is for, person by person, and exactly what will be saved. */
export default function AppointmentSummary({
  client, people, peopleCount, subtotal, discount, total, durationMins, addonMins,
  date, mode, startTime, windowStart, windowEnd, repeat, occurrenceCount,
}) {
  const scheduling = mode === 'exact'
    ? `${rangeLabel(startTime, startTime + durationMins / 60)}`
    : `Availability window ${rangeLabel(windowStart, windowEnd)}`;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
            {(client.name || '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">{client.name || 'No client yet'}</p>
            <p className="truncate text-xs text-zinc-500">{client.phone || 'Add a phone number'}</p>
          </div>
        </div>
        {(client.email || client.address) && (
          <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
            {client.email && <p className="truncate">{client.email}</p>}
            {client.address && <p className="truncate">{client.address}</p>}
          </div>
        )}
        {client.record?.notes && (
          <div className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{client.record.notes}</div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Appointment</p>
        <div className="divide-y divide-zinc-100">
          <Row label="Customer">{client.name || '—'}</Row>
          <Row label="People">{peopleCount > 0 ? peopleCount : '—'}</Row>

          {/* One line per person: their main service, then their own add-ons. */}
          {people.length > 0 && (
            <div className="space-y-1.5 py-2.5">
              {people.map((person, index) => (
                <div key={person.key} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-xs">
                    <span className="text-zinc-500">Person {index + 1}</span>{' '}
                    <span className="font-medium text-zinc-900">{[person.primary, ...person.addons].join(' + ')}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-600">{money(person.price)}</span>
                </div>
              ))}
            </div>
          )}

          <Row label="Duration">
            {durationMins > 0 ? serviceDuration(durationMins) : '—'}
            {addonMins > 0 && <span className="ml-1 text-zinc-500">({addonMins} min add-ons)</span>}
          </Row>
          {discount > 0 && <Row label="Subtotal">{money(subtotal)}</Row>}
          {discount > 0 && <Row label="Group discount">{`− ${money(discount)}`}</Row>}
          <Row label="Total">{money(total)}</Row>
          <Row label="Date">{dateLabel(date)}</Row>
          <Row label="Scheduling">{scheduling}</Row>
          <Row label="Repeat">
            {repeat.enabled ? `${frequencyLabel(repeat.everyWeeks)} · ${endsLabel(repeat)}` : 'Does not repeat'}
          </Row>
          {repeat.enabled && <Row label="Occurrences">{occurrenceCount}</Row>}
        </div>
      </div>
    </div>
  );
}