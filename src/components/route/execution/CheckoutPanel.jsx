import React, { useMemo, useState } from 'react';
import { Check, MapPin, Copy, Pencil } from 'lucide-react';
import { decimalToLabel } from '@/lib/timeUtils';
import { money } from '@/lib/paymentApi';
import useCopyAddress from './useCopyAddress';
import ServiceEditor from './ServiceEditor';
import PaymentBlock from './PaymentBlock';

const key = (v) => String(v ?? '').trim().toLowerCase();

/** Each thing being cut, with the catalogue price for it. Display only: the server reprices. */
function buildLines(booking, catalogue) {
  const svc = new Map(); const add = new Map();
  for (const s of catalogue?.services || []) if (s?.is_active !== false) svc.set(key(s.name), Number(s.price) || 0);
  for (const a of catalogue?.addons || []) if (a?.is_active !== false) add.set(key(a.name), Number(a.price_adjustment) || 0);
  const participants = Array.isArray(booking?.participants) && booking.participants.length
    ? booking.participants
    : [{ primary_service: (booking?.services || [])[0] || '', addons: (booking?.services || []).slice(1) }];
  const lines = [];
  for (const p of participants) {
    if (p.primary_service) lines.push({ name: p.primary_service, price: svc.has(key(p.primary_service)) ? svc.get(key(p.primary_service)) : null });
    for (const a of p.addons || []) lines.push({ name: a, price: add.has(key(a)) ? add.get(key(a)) : null });
  }
  return lines;
}

/** The client's checkout: who, where, what was cut, and how they are paying for it. */
export default function CheckoutPanel({
  stop, booking, catalogue, owing, busy, error, processing, waited, note,
  onClose, onPayCard, onOffline, onCheck, onComplete, onSaveServices,
}) {
  const { copied, copy } = useCopyAddress();
  const [editing, setEditing] = useState(false);
  const [savingService, setSavingService] = useState(false);
  const lines = useMemo(() => buildLines(booking, catalogue), [booking, catalogue]);
  const subtotal = Number(booking?.subtotal ?? booking?.price ?? 0);
  const discount = Number(booking?.group_discount || 0);
  const total = Number(booking?.price || 0);

  const saveServices = async (services) => {
    setSavingService(true);
    const ok = await onSaveServices(services);
    setSavingService(false);
    if (ok) setEditing(false);
  };

  return (
    <div className="flex max-h-[92vh] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-foreground">{booking?.client_name || stop.clientName}</p>
          <p className="text-[12px] text-muted-foreground">
            {decimalToLabel(stop.apptStart)} · {booking?.services?.length || 0} item{(booking?.services?.length || 0) === 1 ? '' : 's'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="-mr-1.5 -mt-1 flex h-10 items-center rounded-xl px-3 text-[13px] font-semibold text-muted-foreground active:bg-muted">
          Close
        </button>
      </div>

      {stop.address && (
        <div className="border-b border-border px-4 py-3">
          <p className="break-words text-[12px] text-muted-foreground">{stop.address}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => copy(stop.address)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-[13px] font-semibold text-foreground active:bg-muted">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy address'}
            </button>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-[13px] font-semibold text-foreground active:bg-muted"
            >
              <MapPin className="h-3.5 w-3.5" /> Open in Maps
            </a>
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-bold text-foreground">Service</p>
          {!editing && !processing && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground active:opacity-70">
              <Pencil className="h-3 w-3" /> Edit service
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-2">
            <ServiceEditor
              catalogue={catalogue}
              participants={booking?.participants}
              busy={savingService}
              onSave={saveServices}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <ul className="mt-2 space-y-1.5">
              {lines.map((line, i) => (
                <li key={`${line.name}-${i}`} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 break-words text-foreground">{line.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{line.price == null ? '—' : money(line.price)}</span>
                </li>
              ))}
              {lines.length === 0 && <li className="text-[12px] text-muted-foreground">No services on this booking.</li>}
            </ul>
            <div className="mt-3 space-y-1 border-t border-border pt-2.5 text-[13px]">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Group discount</span><span className="tabular-nums">−{money(discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-[15px] font-bold text-foreground">
                <span>Total</span><span className="tabular-nums">{money(total)}</span>
              </div>
            </div>
            {booking && !processing && (
              <button type="button" onClick={() => setEditing(true)} className="mt-2.5 text-[12px] font-semibold text-muted-foreground active:opacity-70">
                + Add another service
              </button>
            )}
          </>
        )}
      </div>

      {note && <p className="mx-4 mb-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{note}</p>}

      <PaymentBlock
        owing={owing}
        busy={busy}
        processing={processing}
        waited={waited}
        error={error}
        onPayCard={onPayCard}
        onOffline={onOffline}
        onCheck={onCheck}
        onComplete={onComplete}
      />

      <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        After payment, set a reminder for their next cut.
      </p>
    </div>
  );
}