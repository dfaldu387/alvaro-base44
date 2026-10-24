import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtDate } from '@/lib/reminderMeta';

const PHRASE = 'TURN OFF DRY RUN';
const errText = (e) => e?.response?.data?.message || e?.message || 'Could not change dry-run mode.';
const light = 'bg-white text-zinc-800 hover:bg-zinc-100';

/**
 * The only control for dry-run mode. Turning it OFF takes TWO different admins:
 * one requests (typed phrase, recorded preview), a second reviews and approves.
 * The server enforces this; this panel only drives it.
 */
export default function DryRunControl({ preview, onChanged }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const on = preview.dry_run;
  const pending = preview.pending_off_request;
  const mine = pending && pending.requested_by_id === preview.viewer_id;

  const send = async (payload) => {
    setBusy(true); setMsg('');
    try {
      const r = (await base44.functions.invoke('setCampaignDryRun', payload)).data;
      setMsg(r.message); setOpen(false); setPhrase(''); onChanged();
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2">
      <p className="text-sm font-bold text-zinc-900">Dry-run mode: {on ? 'ON (safe: nothing is ever sent)' : 'OFF (live sending allowed once messages are approved)'}</p>
      {!on && <Button size="sm" disabled={busy} onClick={() => send({ action: 'turn_on' })}>Turn dry-run back ON</Button>}

      {on && !pending && !open && <Button size="sm" variant="outline" className={light} onClick={() => setOpen(true)}>Request to turn dry-run OFF…</Button>}
      {on && !pending && open && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs text-red-800">This starts a request. A different admin must review the current preview and approve it before anything can be sent. The preview for both stages must already be recorded this week.</p>
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={`Type ${PHRASE}`} />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy || phrase !== PHRASE} onClick={() => send({ action: 'request_off', confirm: phrase })}>{busy ? 'Saving…' : 'Send request'}</Button>
            <Button size="sm" variant="outline" className={light} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {on && pending && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            {pending.requested_by} asked to turn dry-run OFF on {fmtDate(pending.requested_at)}. Expires {fmtDate(pending.expires_at)}.
            {mine ? ' Waiting for a different admin to approve. You cannot approve your own request.' : ' Review the preview above, then approve only if it is correct.'}
          </p>
          <div className="flex gap-2">
            {!mine && <Button size="sm" variant="destructive" disabled={busy} onClick={() => window.confirm('Approve turning dry-run OFF? Real campaigns can then send.') && send({ action: 'approve_off', approval_id: pending.id })}>{busy ? 'Saving…' : 'Approve: turn OFF'}</Button>}
            <Button size="sm" variant="outline" className={light} disabled={busy} onClick={() => send({ action: 'cancel_off' })}>Cancel request</Button>
          </div>
        </div>
      )}

      {msg && <p className="text-xs text-zinc-700">{msg}</p>}
      <div className="text-[11px] text-zinc-500">
        <p className="font-semibold">Change history</p>
        {preview.changes.length === 0 ? <p>No changes recorded. Dry-run has been ON since the start.</p> : preview.changes.map((c, i) => (
          <p key={i}>{fmtDate(c.changed_at)} · {c.changed_by} · {c.previous_value ? 'ON' : 'OFF'} → {c.new_value ? 'ON' : 'OFF'}{c.approved_by ? ` · ${c.approved_by}` : ''}</p>
        ))}
      </div>
    </div>
  );
}