import React from 'react';
import { Banknote, Send } from 'lucide-react';
import useStopPayment from '@/hooks/useStopPayment';
import { collectable, linkStatusLine, owingOf } from '@/lib/stopPayment';
import { money } from '@/lib/paymentApi';

const BTN = 'flex-1 min-w-0 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50';

/** The money still owing at a stop the barber has completed: text the payment link, or mark it paid in cash. Shows nothing when nothing is owing. */
export default function StopPayment({ stop }) {
  const { pay, msg, busy, error, act } = useStopPayment(stop.requestId);
  if (!collectable(pay)) return null;
  return (
    <div className="mx-4 mb-3 bg-card border border-primary/40 rounded-2xl px-4 py-3" data-testid="stop-payment">
      <p className="text-[13px] font-bold text-foreground break-words">{stop.clientName} owes {money(owingOf(pay))}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{linkStatusLine(pay, msg)}</p>
      {error && <p role="alert" className="text-[11px] text-red-400 mt-1 break-words">{error}</p>}
      <div className="flex gap-2 mt-2.5">
        {!msg && (
          <button type="button" disabled={busy} onClick={() => act('send_link')} className={`${BTN} bg-card border border-border text-foreground`}>
            <Send className="w-4 h-4 shrink-0" /> Text pay link
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => act('mark_cash')} className={`${BTN} bg-primary text-white`}>
          <Banknote className="w-4 h-4 shrink-0" /> Paid cash
        </button>
      </div>
    </div>
  );
}