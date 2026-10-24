import React, { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { money } from '@/lib/paymentApi';

const key = (v) => String(v ?? '').trim().toLowerCase();
const active = (rows) => (rows || []).filter(r => r?.is_active !== false);

/**
 * Change what was cut before the money is taken: one main service and any add-ons.
 * The price is never worked out here — saving sends the names to the server, which
 * reprices from the live catalogue and returns the new total.
 */
export default function ServiceEditor({ catalogue, participants, busy, onSave, onCancel }) {
  const services = useMemo(() => active(catalogue?.services), [catalogue]);
  const addons = useMemo(() => active(catalogue?.addons), [catalogue]);
  const first = (participants || [])[0] || {};
  const [primary, setPrimary] = useState(first.primary_service || services[0]?.name || '');
  const [picked, setPicked] = useState(() => new Set((participants || []).flatMap(p => p?.addons || [])));

  const toggle = (name) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Main service</p>
      <div className="mt-1.5 space-y-1.5">
        {services.map(s => (
          <button
            key={s.id || s.name}
            type="button"
            onClick={() => setPrimary(s.name)}
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-[13px] ${primary === s.name ? 'border-primary bg-card font-semibold text-foreground' : 'border-border bg-card text-muted-foreground'}`}
          >
            <span className="truncate">{s.name}</span>
            <span className="ml-2 shrink-0 tabular-nums">{money(s.price)}</span>
          </button>
        ))}
        {services.length === 0 && <p className="text-[12px] text-muted-foreground">No services in the catalogue.</p>}
      </div>

      {addons.length > 0 && (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Add-ons</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {addons.map(a => (
              <button
                key={a.id || a.name}
                type="button"
                onClick={() => toggle(a.name)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${picked.has(a.name) ? 'border-primary bg-card font-semibold text-foreground' : 'border-border bg-card text-muted-foreground'}`}
              >
                {picked.has(a.name) && <Check className="h-3 w-3" />}
                {a.name} · {money(a.price_adjustment)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || !primary}
          onClick={() => onSave([primary, ...picked].filter(Boolean))}
          className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save service'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="h-11 rounded-xl border border-border px-4 text-sm font-semibold text-foreground disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}