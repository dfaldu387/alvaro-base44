import React, { useState } from 'react';
import { Copy } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import MessageComposer from '@/components/chat/MessageComposer';

/** The barber's usual one-tap replies. Tapping one puts it in the box to review and send. */
const QUICK_REPLIES = ['On my way', 'Running late', "I've arrived"];

/**
 * Manual send, in the same composer as every other conversation. The text goes to
 * the outbox through sendManualMessage — never straight from the browser. Opted-out
 * clients cannot be sent to; they get the copy-the-reminder option instead.
 */
export default function ManualSendBox({ client, onQueued }) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (client.messaging_opted_out === true) {
    const copy = async () => {
      try { await navigator.clipboard.writeText(client.reminder_message || ''); toast({ title: 'Reminder copied' }); }
      catch { toast({ title: 'Copy failed' }); }
    };
    return (
      <div className="flex items-center gap-3 border-t border-zinc-100 bg-amber-50 px-4 py-3">
        <p className="flex-1 text-xs text-amber-800">This client has opted out of messages, so nothing can be sent from here. You can copy their reminder and contact them yourself.</p>
        <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100">
          <Copy className="h-3.5 w-3.5" /> Copy reminder
        </button>
      </div>
    );
  }

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await base44.functions.invoke('sendManualMessage', { client_id: client.id, text });
      setText('');
      toast({ title: res?.data?.will_be_suppressed ? 'Queued — test client, will not be delivered' : 'Queued for sending' });
      onQueued();
    } catch (e) {
      toast({ title: 'Could not queue the message', description: e?.response?.data?.error || e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <MessageComposer
      value={text}
      onChange={setText}
      onSend={send}
      busy={busy}
      disabled={!client.phone}
      placeholder={client.phone ? 'Message' : 'This client has no phone number'}
      quickReplies={client.phone ? QUICK_REPLIES : []}
      hint={client.is_test === true ? 'Test client: messages are queued but never delivered.' : undefined}
    />
  );
}