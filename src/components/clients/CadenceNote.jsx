import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Says in plain words which cadence the system believes and why. When a measurement exists and is not
 * already the person's own choice, one tap makes it their choice (sets the label to that many days).
 * Nothing is sent and no reminder date is changed by accepting.
 */
export default function CadenceNote({ cadence, clientId, onAccepted }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!cadence) return null;

  const accept = async () => {
    setBusy(true); setFailed(false);
    try {
      await base44.entities.ReminderClient.update(clientId, { frequency: 'Custom', custom_frequency_days: cadence.measured_days, cadence_source: 'manual' });
      setDone(true);
      onAccepted?.(cadence.measured_days);
    } catch { setFailed(true); }
    setBusy(false);
  };

  return (
    <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-2 space-y-1.5 min-w-0">
      <p className="text-[11px] text-zinc-700 break-words">{done ? `Saved: every ${cadence.measured_days} days is now your choice.` : cadence.text}</p>
      {cadence.can_accept && !done && (
        <button type="button" onClick={accept} disabled={busy} className="h-9 px-3 rounded-md border border-indigo-200 bg-white text-xs font-semibold text-indigo-700 disabled:opacity-50">
          {busy ? 'Saving…' : `Use every ${cadence.measured_days} days`}
        </button>
      )}
      {failed && <p className="text-[11px] text-red-600">Could not save. Please try again.</p>}
    </div>
  );
}