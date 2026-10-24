import React, { useState } from 'react';
import { addDays, format } from 'date-fns';
import { ArrowRight, Check, PartyPopper } from 'lucide-react';

const OPTIONS = [
  { label: 'Weekly', hint: '7 days', days: 7 },
  { label: 'Fortnightly', hint: '2 weeks', days: 14 },
  { label: 'Every 3 weeks', hint: '21 days', days: 21 },
  { label: 'Monthly', hint: '4 weeks', days: 30 },
  { label: 'Custom', hint: 'Set your own date', days: null },
];

/** The client's own rhythm, so the usual choice is already selected. */
function preselect(client) {
  if (!client) return '';
  const named = OPTIONS.find(o => o.label === client.frequency);
  if (named) return named.label;
  const days = Number(client.cadence_interval_days) || 0;
  if (!(days > 0)) return '';
  const near = OPTIONS.filter(o => o.days).reduce((best, o) => (Math.abs(o.days - days) < Math.abs(best.days - days) ? o : best));
  return Math.abs(near.days - days) <= 3 ? near.label : '';
}

function Steps() {
  const step = 'flex items-center gap-1.5 text-[11px] font-semibold';
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-3">
      <span className={`${step} text-emerald-600`}><Check className="h-3.5 w-3.5" /> Checkout</span>
      <span className="h-px flex-1 bg-border" />
      <span className={`${step} text-foreground`}>2 · Next haircut</span>
      <span className="h-px flex-1 bg-border" />
      <span className={`${step} text-muted-foreground`}>3 · Complete</span>
    </div>
  );
}

/**
 * Everything after the money: put the client back into the rebooking workflow, so the
 * barber never has to remember to chase them. The rhythm chosen here is stored as the
 * client's own choice (it beats any measured guess) and sets their next due date.
 */
export default function NextHaircutPanel({ client, visitDate, paid, outstanding, busy, error, onAdd, onSkip }) {
  const [frequency, setFrequency] = useState(() => preselect(client));
  const [customDate, setCustomDate] = useState(() => format(addDays(new Date(`${visitDate}T00:00:00`), 1), 'yyyy-MM-dd'));
  const firstName = String(client?.client_name || '').trim().split(/\s+/)[0] || 'this client';
  const minDate = format(addDays(new Date(`${visitDate}T00:00:00`), 1), 'yyyy-MM-dd');

  return (
    <div className="flex max-h-[92vh] flex-col">
      <div className="border-b border-border px-4 py-3.5">
        <p className="flex items-center gap-2 text-[15px] font-bold text-foreground">
          <PartyPopper className="h-4 w-4 text-emerald-600" />
          {paid ? 'Payment received' : 'Nothing owing'}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Checkout is done — this appointment is complete.</p>
      </div>

      <Steps />

      <div className="px-4 py-4">
        <p className="text-[16px] font-bold text-foreground">When would you like your next cut?</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Add a reminder to keep {firstName} in the rotation.
        </p>
        {outstanding > 0 && (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            ${outstanding.toFixed(2)} is still owing on this appointment.
          </p>
        )}

        <div className="mt-3 space-y-2">
          {OPTIONS.map(opt => {
            const selected = frequency === opt.label;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setFrequency(opt.label)}
                className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left ${selected ? 'border-primary bg-primary/[0.06]' : 'border-border bg-card'}`}
              >
                <span className={`text-[13px] ${selected ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>{opt.label}</span>
                <span className="text-[12px] text-muted-foreground">{opt.hint}</span>
              </button>
            );
          })}
        </div>

        {frequency === 'Custom' && (
          <input
            type="date"
            value={customDate}
            min={minDate}
            onChange={e => setCustomDate(e.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-border bg-card px-3 text-[14px] text-foreground"
          />
        )}

        {error && <p role="alert" className="mt-2 break-words text-[12px] text-red-500">{error}</p>}

        <button
          type="button"
          disabled={busy || !frequency || (frequency === 'Custom' && !customDate)}
          onClick={() => onAdd(frequency, frequency === 'Custom' ? customDate : undefined)}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add to reminder workflow'} {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
        <button type="button" disabled={busy} onClick={onSkip} className="mt-2 h-11 w-full rounded-xl text-[13px] font-semibold text-muted-foreground disabled:opacity-50">
          Skip for now
        </button>
      </div>
    </div>
  );
}