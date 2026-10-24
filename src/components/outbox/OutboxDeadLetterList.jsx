import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';

export default function OutboxDeadLetterList({ items, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  const requeue = async (id) => {
    setBusyId(id);
    try {
      await base44.functions.invoke('requeueDeadLetter', { outbox_id: id });
      onChanged?.();
    } catch (e) {
      const msg = e?.response?.data?.error || 'Could not re-queue this message.';
      setNotes((n) => ({ ...n, [id]: msg }));
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) {
    return <p className="text-xs text-zinc-400">No dead-lettered items.</p>;
  }
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-zinc-800">
              {item.channel} · {item.template_key || 'no template'} · {item.attempt_count || 0} attempts
            </p>
            <button
              onClick={() => requeue(item.id)}
              disabled={busyId === item.id}
              className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
            >
              {busyId === item.id ? 'Re-queuing…' : 'Re-queue'}
            </button>
          </div>
          <p className="text-xs text-red-700 mt-0.5">{item.dead_letter_reason || 'No reason recorded.'}</p>
          {item.last_error && <p className="text-[11px] text-zinc-500 mt-0.5">Last error: {item.last_error}</p>}
          {notes[item.id] && <p className="text-[11px] text-red-600 mt-0.5">{notes[item.id]}</p>}
        </div>
      ))}
    </div>
  );
}