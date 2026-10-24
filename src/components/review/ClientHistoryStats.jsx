import React, { useEffect, useState } from 'react';
import { fetchClientHistory } from '@/lib/reviewQueue';

const Tile = ({ label, value, warn }) => (
  <div className={`rounded-lg border px-2.5 py-2 ${warn ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 bg-zinc-50'}`}>
    <p className="text-[11px] text-zinc-500">{label}</p>
    <p className="text-base font-bold text-zinc-900">{value}</p>
  </div>
);

// No-shows, cancellations and completed bookings, counted on the server.
export default function ClientHistoryStats({ clientId }) {
  const [h, setH] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientId) return;
    fetchClientHistory(clientId).then((res) => (res.ok ? setH(res.history) : setError(res.error)));
  }, [clientId]);

  if (!clientId) return <p className="text-xs text-zinc-500">No client record is linked to this booking, so there is no history.</p>;
  if (error) return <p className="text-xs text-red-600">Could not load history: {error}</p>;
  if (!h) return <p className="text-xs text-zinc-500">Loading history…</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <Tile label="Completed bookings" value={h.completed} />
      <Tile label="No-shows" value={h.no_shows} warn={h.no_shows > 0} />
      <Tile label="Cancellations" value={h.cancellations} />
      <Tile label={`Late cancellations (<${h.late_cancel_hours}h)`} value={h.late_cancellations} warn={h.late_cancellations > 0} />
    </div>
  );
}