import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import CancelDepositChoice from '@/components/payments/CancelDepositChoice';

/**
 * Cancel one stop from its Route card.
 *
 * The cancellation does not complete until the deposit question is answered, so the same
 * protection the Calendar and the Requests page use is shown here and its answer is handed
 * to declineBookingRequest unchanged.
 */
export default function StopCancelDialog({ stop, busy, error, onClose, onConfirm }) {
  const [deposit, setDeposit] = useState({ ready: false, decision: null, opSeq: 0 });
  if (!stop) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
        <div>
          <h3 className="text-base font-bold text-zinc-900">Cancel this appointment?</h3>
          <p className="mt-1 text-sm text-zinc-500">
            {stop.clientName} will be marked cancelled and kept in history. The client is messaged by the server.
          </p>
        </div>

        {stop.requestId && <CancelDepositChoice bookingId={stop.requestId} onChange={setDeposit} />}
        {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            Keep
          </button>
          <button type="button" disabled={!deposit.ready || busy}
            onClick={() => onConfirm(deposit.decision ? { deposit_decision: deposit.decision, expected_op_seq: deposit.opSeq } : {})}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Cancel It
          </button>
        </div>
      </div>
    </div>
  );
}