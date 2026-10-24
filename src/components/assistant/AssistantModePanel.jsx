import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { MODES, setAssistantMode } from '@/lib/assistant';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * AI assistant mode. Its own switch: separate from the messaging mode above it and
 * from the campaign dry run. A missing value means Draft.
 */
export default function AssistantModePanel({ settings, onChanged }) {
  const mode = MODES[settings?.assistant_mode] ? settings.assistant_mode : 'draft';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmLive, setConfirmLive] = useState(false);

  const save = async (next) => {
    setBusy(true); setError('');
    const res = await setAssistantMode(next);
    if (!res.ok) setError(res.error); else { await onChanged?.(); setConfirmLive(false); }
    setBusy(false);
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">AI assistant for incoming texts</p>
        <p className="text-xl font-extrabold text-zinc-900">{MODES[mode].label}</p>
        <p className="text-sm text-zinc-600">{MODES[mode].text}</p>
        <p className="text-xs text-zinc-500 mt-1">Always, in every setting: it never changes a booking, never replies to angry or unclear messages, and passes every reply through a check that blocks any time or price it wasn't given. Change requests are recorded and acknowledged. This is separate from the messaging mode and the campaign dry run.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {Object.entries(MODES).map(([key, m]) => (
          <button key={key} disabled={busy || key === mode} onClick={() => (key === 'live' ? setConfirmLive(true) : save(key))}
            className={cn('min-h-[44px] rounded-lg border px-3 py-2 text-left text-sm font-bold', key === mode ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:opacity-50')}>
            {key === mode ? `${m.label} (current)` : m.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
      <AlertDialog open={confirmLive} onOpenChange={(o) => { if (!o) setConfirmLive(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Let the assistant answer automatically?</AlertDialogTitle>
            <AlertDialogDescription>
              Replies to routine questions will be queued without you checking them first. They still pass the time and price check, and still obey the messaging mode, opt-outs and quiet hours. Your name and the time will be recorded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); save('live'); }}>{busy ? 'Switching…' : 'Yes, go live'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}