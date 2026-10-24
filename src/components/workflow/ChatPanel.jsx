import React, { useState } from 'react';
import { X, ExternalLink, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { initials } from '@/lib/reminderUtils';
import MessageComposer from '@/components/chat/MessageComposer';

/** The barber's usual one-tap replies. Tapping one puts it in the box to review and send. */
const QUICK_REPLIES = ['On my way', 'Running late', "I've arrived"];

/**
 * Compact conversation side panel for the workflow board. The same visual language
 * as the Messages page — minimal header, bubbles, pill composer — just smaller.
 * Messages remains the complete communication centre.
 */
export default function ChatPanel({ client, onClose, onSend }) {
  const [reply, setReply] = useState('');

  const send = () => {
    if (!reply.trim()) return;
    onSend?.(reply.trim());
    setReply('');
  };

  return (
    <div className="fixed inset-0 z-[68] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col border-l border-zinc-200 bg-white sm:max-w-[380px]">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600">
            {initials(client.client_name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-zinc-900">{client.client_name}</p>
            <p className="truncate text-[11px] text-zinc-400">{client.phone || client.suburb || '—'}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100"><MessageSquare className="h-4 w-4 text-zinc-400" /></div>
            <p className="text-xs text-zinc-400">No messages in this conversation yet.</p>
            <p className="text-[11px] text-zinc-400">Reminders and replies are queued in Messages.</p>
          </div>
        </div>

        <div className="border-t border-zinc-100 px-4 py-2">
          <Link to="/admin/messages" className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7c3aed] hover:text-[#6d28d9]">
            <ExternalLink className="h-3 w-3" /> Open full conversation
          </Link>
        </div>
        <MessageComposer
          value={reply}
          onChange={setReply}
          onSend={send}
          quickReplies={client.phone ? QUICK_REPLIES : []}
          disabled={!client.phone}
          placeholder={client.phone ? 'Message' : 'This client has no phone number'}
        />
      </div>
    </div>
  );
}