import React, { useState } from 'react';
import { X, Ban, Loader2 } from 'lucide-react';
import { declineBookingRequest, DECLINE_REASONS } from '@/lib/requestAdmin';
import CancelDepositChoice from '@/components/payments/CancelDepositChoice';

/**
 * Confirm a decline.
 *
 * Declining never deletes anything: the request keeps its record, its reason and
 * its audit trail, and simply leaves the active queue. The reason is optional —
 * the request is declined either way.
 */
export default function DeclineRequestModal({ request, onClose, onDone }) {
  const [reason, setReason] = useState(DECLINE_REASONS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A booking that holds money cannot be cancelled until someone says what happens to it.
  const [deposit, setDeposit] = useState({ ready: false, decision: null, opSeq: 0 });

  const confirm = async () => {
    setSaving(true);
    setError('');
    const data = await declineBookingRequest({
      booking_request_id: request.id, reason,
      ...(deposit.decision ? { deposit_decision: deposit.decision, expected_op_seq: deposit.opSeq } : {}),
    });
    setSaving(false);
    if (!data || data.saved !== true) {
      setError(data?.error || 'That request could not be declined. Please try again.');
      return;
    }
    onDone?.(reason);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-zinc-200 shadow-xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 shrink-0">
          <h2 className="text-base font-bold text-zinc-900">Decline this booking request?</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-zinc-900">{request.client_name}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {request.requested_date || request.day} · {request.availability_window || 'Flexible'}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Optional decline reason</p>
            <div className="space-y-1.5">
              {DECLINE_REASONS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReason(option)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                    reason === option
                      ? 'border-red-300 bg-red-50 text-red-700 font-semibold'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <CancelDepositChoice bookingId={request.id} onChange={setDeposit} />

          <p className="text-xs text-zinc-500 leading-relaxed">
            The request stays in your history with this reason and its audit trail — it only leaves
            the active request queue.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-zinc-200 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
          >
            Keep request
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={saving || !deposit.ready}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            {saving ? 'Declining…' : 'Decline request'}
          </button>
        </div>
      </div>
    </div>
  );
}