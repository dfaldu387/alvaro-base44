import React, { useState } from 'react';
import { Navigation, Phone, MessageSquare, CheckCircle2, Send, SkipForward, Receipt, MapPin, Clock } from 'lucide-react';
import { nextStep } from '@/lib/routeStops';
import StopMessageDialog from '@/components/route/StopMessageDialog';
import useStopPayment from '@/hooks/useStopPayment';
import { owedAtCheckout } from '@/lib/stopPayment';
import { money } from '@/lib/paymentApi';
import { decimalToLabel } from '@/lib/timeUtils';
import { navigateHref } from '@/lib/navLinks';
import CopyAddressButton from '@/components/route/CopyAddressButton';

// Stored states before the barber arrives. ("Barber preparing" and "Arriving soon" are customer-view labels only.)
const BEFORE_ARRIVAL = ['planned', 'on_the_way'];

function RoundAction({ icon, label, href, onClick }) {
  const cls = 'flex flex-col items-center justify-center gap-1 bg-card border border-border rounded-2xl w-16 h-[52px] active:opacity-70';
  const body = (<>{icon}<span className="text-[9px] font-semibold text-muted-foreground">{label}</span></>);
  return href
    ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={cls}>{body}</a>
    : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/**
 * The stop the barber is on: who, when, where, how to reach them, what is still owed,
 * and the two things that finish the job.
 *
 * It sits in the page rather than pinned over it, so the route timeline below is never
 * covered, and Mark Completed is its own button — finishing the cut never takes money
 * by itself. Checkout is the only thing that charges anyone.
 */
export default function CurrentStopPanel({
  stop, leaveBy, minsToNext, exec, busy, error, onAdvance, onCheckout, stopNumber, totalStops,
  className = 'mx-4 mb-3',
}) {
  const [messageOpen, setMessageOpen] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  const state = exec?.state || 'planned';
  const step = nextStep(state);
  const canSignalOnTheWay = BEFORE_ARRIVAL.includes(state) && state !== 'on_the_way';
  const { pay } = useStopPayment(stop.requestId);

  const balance = owedAtCheckout(pay);
  const services = (stop.services || []).filter(Boolean).join(', ') || 'Service';
  const provisional = stop.schedule_status && stop.schedule_status !== 'confirmed';

  return (
    <div className={`${className} rounded-2xl border border-border bg-card p-4`}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary">Current stop</p>
            {stopNumber && totalStops ? (
              <span className="text-[10px] font-semibold text-muted-foreground">{stopNumber} of {totalStops}</span>
            ) : null}
            <span data-testid="stop-state" className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
              {exec?.customer_state || 'Confirmed'}
            </span>
            {provisional && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">Provisional</span>
            )}
            {stop.is_test && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">TEST</span>
            )}
          </div>
          <p className="truncate text-[17px] font-bold leading-tight text-foreground">
            {decimalToLabel(stop.apptStart)} · {stop.clientName}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" /> {stop.duration} min · {services}
          </p>
          {stop.address && (
            <div className="mt-1 flex items-start gap-1">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words text-[11px] leading-snug text-muted-foreground">{stop.address}</span>
              <CopyAddressButton address={stop.address} className="-mt-0.5 -ml-0.5" />
            </div>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Leave by {leaveBy}{minsToNext != null ? ` · ${minsToNext} min to next stop` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <RoundAction icon={<Navigation className="h-4 w-4 text-foreground" />} label="Navigate" href={navigateHref(stop.address) || undefined} />
          {stop.phone && <RoundAction icon={<Phone className="h-4 w-4 text-foreground" />} label="Call" href={`tel:${stop.phone}`} />}
          <RoundAction icon={<MessageSquare className="h-4 w-4 text-foreground" />} label="Message" onClick={() => setMessageOpen(true)} />
        </div>
      </div>

      {pay && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
          <span className="text-[11px] font-semibold text-muted-foreground">Balance due</span>
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-bold tabular-nums text-foreground">{money(balance)}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${balance > 0 ? 'bg-amber-500/15 text-amber-600' : 'bg-green-500/15 text-green-600'}`}>
              {balance > 0 ? 'Unpaid' : 'Paid'}
            </span>
          </span>
        </div>
      )}

      {error && <p role="alert" className="mb-2 text-[11px] text-red-500">{error}</p>}

      {skipping ? (
        <div className="space-y-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this stop being skipped?" maxLength={300}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setSkipping(false)} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-muted-foreground">Cancel</button>
            <button type="button" disabled={busy || !reason.trim()} onClick={() => onAdvance('skip', reason.trim()).then((ok) => { if (ok) { setSkipping(false); setReason(''); } })}
              className="flex-1 rounded-xl bg-red-500/90 py-2.5 text-sm font-bold text-white disabled:opacity-40">Skip stop</button>
          </div>
        </div>
      ) : (
        <>
          {canSignalOnTheWay && (
            <button type="button" disabled={busy} onClick={() => onAdvance('on_the_way')}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-2.5 text-sm font-semibold text-foreground disabled:opacity-50">
              <Send className="h-4 w-4" /> On my way (message client)
            </button>
          )}
          <div className="flex gap-2">
            {/* Finishing the cut and taking the money are two separate decisions. */}
            <button type="button" disabled={busy} onClick={() => onAdvance(step.action)}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60">
              <CheckCircle2 className="h-4 w-4" /> {step.label}
            </button>
            <button type="button" disabled={busy} onClick={() => onCheckout?.(stop)}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/5 py-3 text-sm font-bold text-primary active:scale-[0.98] disabled:opacity-60">
              <Receipt className="h-4 w-4" /> Checkout
            </button>
          </div>
          <button type="button" onClick={() => setSkipping(true)} className="mt-2 flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
            <SkipForward className="h-3.5 w-3.5" /> Emergency skip
          </button>
        </>
      )}
      <StopMessageDialog requestId={stop.requestId} open={messageOpen} onClose={() => setMessageOpen(false)} />
    </div>
  );
}