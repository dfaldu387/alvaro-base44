import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';
import { currentMode, stamp } from '@/lib/automation';
import AllowlistEditor from '@/components/automation/AllowlistEditor';
import LiveConfirmDialog from '@/components/automation/LiveConfirmDialog';

const MODES = {
  off: { label: 'Off', cls: 'border-red-300 bg-red-50 text-red-900', text: 'Nothing is sent to anyone. Every queued message is suppressed.' },
  allowlist: { label: 'Allowlist only', cls: 'border-amber-300 bg-amber-50 text-amber-900', text: 'Only the numbers listed below receive messages. Everyone else is suppressed.' },
  live: { label: 'Live', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900', text: 'Every customer receives automated messages.' },
};
const errText = (e) => e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Could not save the change.';

export default function MessagingModePanel({ settings, onChanged }) {
  const { mode, isDefault, numbers } = currentMode(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmLive, setConfirmLive] = useState(false);

  const save = async (body) => {
    setBusy(true); setError('');
    try { await base44.functions.invoke('setMessagingMode', body); await onChanged(); setConfirmLive(false); }
    catch (e) { setError(errText(e)); }
    setBusy(false);
  };
  const pick = (m) => (m === 'live' ? setConfirmLive(true) : save({ mode: m }));

  return (
    <section className={cn('space-y-3 rounded-xl border-2 p-4', MODES[mode].cls)}>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Messaging mode</p>
        <p className="text-2xl font-extrabold">{MODES[mode].label}</p>
        <p className="text-sm">{MODES[mode].text}</p>
        {isDefault && <p className="text-xs mt-1">No mode has been saved yet, so the safe default (allowlist) applies.</p>}
        {mode === 'live' && settings?.went_live_at && <p className="text-xs mt-1">Went live {stamp(settings.went_live_at)} by {settings.went_live_by || 'unknown'}.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(MODES).map(([key, m]) => (
          <button key={key} disabled={busy || key === mode} onClick={() => pick(key)}
            className={cn('rounded-lg border px-3 py-1.5 text-xs font-bold', key === mode ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:opacity-50')}>
            {key === mode ? `${m.label} (current)` : `Switch to ${m.label}`}
          </button>
        ))}
      </div>
      {mode === 'allowlist' && <AllowlistEditor numbers={numbers} busy={busy} onChange={(list) => save({ allowlist_numbers: list })} />}
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
      <LiveConfirmDialog open={confirmLive} busy={busy} onCancel={() => setConfirmLive(false)} onConfirm={() => save({ mode: 'live', confirm_live: true })} />
    </section>
  );
}