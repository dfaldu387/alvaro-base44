import React, { useState } from 'react';
import { Send, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendAssistantDraft, markHandled } from '@/lib/assistant';

/** Send (one tap), Copy and Mark handled for one assistant event. 44px tall touch targets. */
export default function DraftActions({ event, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const pending = event.draft_status === 'pending' && !!event.draft_text;
  const canSend = pending && !!event.client_id;
  const open = event.inbox_status === 'open';

  const send = async () => {
    setBusy(true); setError('');
    const res = await sendAssistantDraft(event.id);
    if (!res.ok) setError(res.error);
    setBusy(false);
    onChanged?.();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(event.draft_text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setError('Could not copy. Select the text instead.'); }
  };
  const handled = async () => { setBusy(true); await markHandled(event.id); setBusy(false); onChanged?.(); };

  if (!open && !pending) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        {canSend && <Button onClick={send} disabled={busy} className="min-h-[44px] w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white"><Send className="w-4 h-4" /> {busy ? 'Sending…' : 'Send this reply'}</Button>}
        {pending && <Button variant="outline" onClick={copy} className="min-h-[44px] w-full sm:w-auto">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}</Button>}
        {open && <Button variant="outline" onClick={handled} disabled={busy} className="min-h-[44px] w-full sm:w-auto">Mark handled</Button>}
      </div>
      {pending && !event.client_id && <p className="text-[11px] text-zinc-500">No client record for this number, so it can't be sent from here.</p>}
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </div>
  );
}