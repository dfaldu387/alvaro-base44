import React, { useState } from 'react';
import { Banknote, Check, CreditCard, Loader2 } from 'lucide-react';

const PRIMARY = 'w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50';
const METHODS = [['Cash', Banknote], ['Transfer', Banknote], ['Card', CreditCard]];

/**
 * The payment half of checkout. A card payment is never called successful here: Square owns
 * that answer, so the panel waits for the provider's confirmation and only then moves on.
 */
export default function PaymentBlock({ owing, busy, processing, waited, error, onPayCard, onOffline, onCheck, onComplete }) {
  const [choosing, setChoosing] = useState(false);
  const nothingOwing = owing <= 0;

  return (
    <div className="border-t border-border px-4 py-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-bold text-foreground">Payment</p>
        <p className={`text-[13px] font-bold ${nothingOwing ? 'text-emerald-600' : 'text-foreground'}`}>
          {nothingOwing ? 'Nothing owing' : `$${owing.toFixed(2)} owing`}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {nothingOwing ? 'This appointment has nothing left to collect.' : 'Mark this appointment as paid.'}
      </p>

      {error && <p role="alert" className="mt-2 break-words text-[12px] text-red-500">{error}</p>}

      {processing ? (
        <div className="mt-3 rounded-xl border border-border bg-muted/60 px-3 py-3">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for Square to confirm
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {waited
              ? 'Still nothing back from Square. You can mark it as paid instead, or check again.'
              : 'The payment page is open. This screen finishes the appointment by itself once Square confirms.'}
          </p>
          <button type="button" disabled={busy} onClick={onCheck} className="mt-2.5 h-10 w-full rounded-xl border border-border text-[13px] font-semibold text-foreground disabled:opacity-50">
            Check again
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {!nothingOwing && (
            <button type="button" disabled={busy} onClick={onPayCard} className={PRIMARY}>
              <CreditCard className="h-4 w-4" /> Process payment
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => (nothingOwing ? onComplete() : setChoosing(c => !c))}
            className={`w-full h-11 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${nothingOwing ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground'}`}
          >
            <Check className="h-4 w-4" /> {nothingOwing ? 'Complete and continue' : 'Mark as paid'}
          </button>
          {choosing && !nothingOwing && (
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map(([method, Icon]) => (
                <button
                  key={method}
                  type="button"
                  disabled={busy}
                  onClick={() => { setChoosing(false); onOffline(method); }}
                  className="h-11 rounded-xl border border-border text-[13px] font-semibold text-foreground active:bg-muted disabled:opacity-50"
                >
                  <Icon className="mx-auto h-4 w-4" />
                  {method}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}