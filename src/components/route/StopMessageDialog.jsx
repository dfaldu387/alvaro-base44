import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';
import ConversationThread from '@/components/messages/ConversationThread';

/** The client's message thread with its manual send box, opened from the current stop. */
export default function StopMessageDialog({ requestId, open, onClose }) {
  const [clientId, setClientId] = useState(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open || !requestId) return;
    setClientId(undefined);
    base44.entities.BookingRequest.get(requestId).then((b) => setClientId(b?.client_id || null)).catch(() => setClientId(null));
  }, [open, requestId]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="p-0 gap-0 max-w-lg bg-white border-zinc-200 overflow-hidden">
        <DialogTitle className="sr-only">Message client</DialogTitle>
        <div className="h-[70vh] flex flex-col text-zinc-900">
          {clientId === undefined && <div className="flex-1 flex items-center justify-center"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}
          {clientId === null && <p className="m-auto text-sm text-zinc-500 px-6 text-center">This booking has no client record, so messages can't be sent from here.</p>}
          {clientId && <ConversationThread clientId={clientId} tick={tick} onBack={onClose} onQueued={() => setTick((t) => t + 1)} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}