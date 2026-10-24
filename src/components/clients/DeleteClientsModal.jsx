import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Trash2, CheckCircle } from 'lucide-react';

// Confirmation modal for the Clients bulk Delete.
// Nothing is removed until the backend has validated linked records; the
// backend reports which clients were deleted and which are protected.
export default function DeleteClientsModal({ ids, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const count = ids.length;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('deleteClients', { clientIds: ids });
      const deletedIds = res.data?.deletedIds || [];
      const blocked = res.data?.blocked || [];
      if (deletedIds.length > 0) {
        onDeleted?.({ deletedIds, blocked });
        setResult({ deletedCount: deletedIds.length, blocked });
      } else if (blocked.length > 0) {
        setError(blocked.length === 1
          ? "Couldn't delete this client because they're linked to confirmed or completed bookings."
          : `Couldn't delete these ${blocked.length} clients because they're linked to confirmed or completed bookings.`);
      } else {
        setError('Nothing was deleted. Please try again.');
      }
    } catch (e) {
      const status = e?.response?.status || e?.status;
      setError(status === 403
        ? 'Only admins can delete clients.'
        : 'Deletion failed. Nothing has been removed — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {result ? (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-base font-bold text-zinc-900">
                  {result.deletedCount} {result.deletedCount === 1 ? 'client' : 'clients'} deleted
                </p>
                <p className="text-xs text-zinc-500 mt-1">These records have been permanently removed.</p>
              </div>
            </div>
            {result.blocked?.length > 0 && (
              <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
                {result.blocked.length} {result.blocked.length === 1 ? 'client was' : 'clients were'} kept because they are linked to confirmed or completed bookings.
              </p>
            )}
            <button onClick={onClose} className="mt-5 w-full h-10 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold">Done</button>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-base font-bold text-zinc-900">
                  {count === 1 ? 'Delete client?' : `Delete ${count} clients?`}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {count === 1
                    ? 'This client record will be permanently removed.'
                    : 'These client records will be permanently removed.'}{' '}
                  Linked booking history may also be affected.
                </p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
              Clients with confirmed or completed bookings are kept automatically, so appointment history is never destroyed.
            </p>

            {error && <p className="text-xs text-red-600 mt-3 leading-relaxed">{error}</p>}

            <div className="flex items-center gap-2 mt-5">
              <button onClick={onClose} disabled={busy} className="flex-1 h-10 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">Cancel</button>
              <button
                onClick={confirm}
                disabled={busy}
                className="flex-1 h-10 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-1.5"
              >
                {busy ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {count === 1 ? 'Delete client' : `Delete ${count} clients`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}