import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Eye } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { STAGE_META, initials, timeSince } from '@/lib/reminderUtils';
import { asList } from '@/lib/conversations';

const STAGES = ['needs_reminder', 'waiting_on_response', 'time_received'];

/** The old copy-and-send-yourself workflow, kept for clients who opted out of automated messages. */
export default function OptedOutFollowUp() {
  const { toast } = useToast();
  const [clients, setClients] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    const page = await base44.entities.ReminderClient.filter(
      { messaging_opted_out: true, workflow_stage: { $in: STAGES } }, { sort: '-workflow_updated_date', limit: 50 },
    );
    setClients(asList(page));
  }, []);
  useEffect(() => { load().catch(() => setClients([])); }, [load]);

  const copy = async (c) => {
    try { await navigator.clipboard.writeText(c.reminder_message || ''); setCopied(c.id); setTimeout(() => setCopied(null), 1500); toast({ title: 'Message copied' }); }
    catch { toast({ title: 'Copy failed' }); }
  };
  const markReplied = async (c) => {
    await base44.entities.ReminderClient.update(c.id, { workflow_stage: 'time_received', workflow_updated_date: new Date().toISOString(), received_day: c.received_day || (c.preferred_day || 'Flexible') });
    toast({ title: 'Marked as replied' });
    await load();
  };

  if (!clients) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (clients.length === 0) return <p className="text-sm text-zinc-400 py-10 text-center">No opted-out clients need a follow-up right now.</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {clients.map((c) => (
        <div key={c.id} className="bg-white border border-zinc-200 rounded-xl p-3.5">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-[11px] font-semibold">{initials(c.client_name)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900 truncate">{c.client_name}</p>
              <p className="text-[11px] text-zinc-400">{STAGE_META[c.workflow_stage]?.label || c.workflow_stage}{c.reminder_sent_date && ` · sent ${timeSince(c.reminder_sent_date)}`}</p>
            </div>
          </div>
          <p className="text-sm text-zinc-700 bg-zinc-50 rounded-lg p-2.5 border border-zinc-100 mb-2">{c.reminder_message || '—'}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => copy(c)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50">
              {copied === c.id ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
            </button>
            {c.workflow_stage === 'waiting_on_response' && (
              <button onClick={() => markReplied(c)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50"><Eye className="w-3.5 h-3.5" /> Mark replied</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}