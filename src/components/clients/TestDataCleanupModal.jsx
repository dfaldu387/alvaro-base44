import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Trash2, CheckCircle } from 'lucide-react';

// Confirmation modal for Clients → Test Clients → Delete Test Data.
// Counts are fetched from the backend (dry run) before anything is removed,
// and deletion only ever targets records flagged is_test = true or records
// securely linked to them.
const ROWS = [
  ['clients', 'test clients'],
  ['bookings', 'test bookings'],
  ['appointments', 'test appointments'],
  ['messages', 'test messages'],
  ['route_flow', 'Route Flow records'],
  ['workflow_items', 'workflow records'],
  ['recurring_setups', 'recurring setups'],
];

export default function TestDataCleanupModal({ onClose, onDone }) {
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [deleted, setDeleted] = useState(null);

  useEffect(() => {
    base44.functions.invoke('deleteTestData', {})
      .then(res => setCounts(res.data?.counts || {}))
      .catch(() => setError('Could not load test data counts. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  const total = counts ? ROWS.reduce((sum, [key]) => sum + (counts[key] || 0), 0) : 0;

  const confirmDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('deleteTestData', { confirm: true });
      setDeleted(res.data?.deleted || {});
      onDone?.();
    } catch {
      setError('Deletion failed. Nothing has been removed — please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {deleted ? (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-base font-bold text-zinc-900">Test data removed</p>
                <p className="text-xs text-zinc-500 mt-1">Real client data has not been affected.</p>
              </div>
            </div>
            <div className="mt-4 space-y-1.5 border-t border-zinc-100 pt-3">
              {ROWS.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{label}</span>
                  <span className="font-semibold text-zinc-900">{deleted[key] || 0} deleted</span>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="mt-5 w-full h-10 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold">Done</button>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-base font-bold text-zinc-900">Delete Test Data?</p>
                <p className="text-xs text-zinc-500 mt-1">This permanently removes test data only.</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3">
              {loading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                  Counting test records…
                </div>
              ) : total === 0 ? (
                <p className="text-xs text-zinc-500">No test data to delete.</p>
              ) : (
                <div className="space-y-1.5">
                  {ROWS.filter(([key]) => (counts?.[key] || 0) > 0).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">{label}</span>
                      <span className="font-semibold text-zinc-900">{counts[key]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
              Only records flagged as test data (and records linked to them) are removed. Real client data will not be affected.
            </p>

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

            <div className="flex items-center gap-2 mt-5">
              <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={loading || deleting || total === 0}
                className="flex-1 h-10 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-bold inline-flex items-center justify-center gap-1.5"
              >
                {deleting ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete Test Data
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}