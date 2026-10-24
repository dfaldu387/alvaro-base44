import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { MessageSquare, AlertTriangle, Clock3, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Client notification status for an appointment whose time was confirmed with the
 * customer.
 *
 * This is a SEPARATE fact from the appointment's scheduling status: the barber can
 * move a confirmed appointment in one drag, but the client only knows about it once
 * a change message was actually accepted by the provider. The line below is read
 * from the queued messages themselves, so "Notified" is never shown for something
 * that was only queued, suppressed or failed.
 */
const TONE = {
  alerted: { icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  sent: { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  waiting: { icon: Clock3, cls: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
};

/** Translate a stored outbox status into what the barber needs to know. */
export function notificationState(outbox) {
  if (!outbox) return { kind: 'waiting', label: 'No time-change message sent', detail: 'The client has not been told about this time.' };
  const status = String(outbox.status || '');
  if (status === 'sent') return { kind: 'sent', label: 'Client notified', detail: 'The change message was accepted for delivery.' };
  if (status === 'failed' || status === 'dead_letter') {
    return { kind: 'alerted', label: 'Not delivered', detail: outbox.last_error || outbox.dead_letter_reason || 'The change message could not be sent.' };
  }
  if (status === 'suppressed') {
    return { kind: 'alerted', label: 'Not sent', detail: outbox.suppressed_reason || 'The change message was deliberately held back.' };
  }
  return { kind: 'waiting', label: 'Queued, not sent yet', detail: outbox.deferral_reason || 'The change message is waiting to be sent.' };
}

export default function ClientNotificationLine({ bookingId, scheduleStatus }) {
  const [outbox, setOutbox] = useState(undefined);

  useEffect(() => {
    if (!bookingId) return undefined;
    let live = true;
    base44.entities.MessageOutbox
      .filter({ booking_request_id: bookingId, template_key: 'booking_changed' }, { sort: '-created_date', limit: 1 })
      .then(page => { if (live) setOutbox((page?.items || [])[0] || null); })
      .catch(() => { if (live) setOutbox(null); });
    return () => { live = false; };
  }, [bookingId]);

  // Only a time confirmed with the customer can be "notified": provisional planning
  // has nothing to tell them yet.
  if (scheduleStatus !== 'confirmed' || outbox === undefined) return null;

  const state = notificationState(outbox);
  const tone = TONE[state.kind];
  const Icon = tone.icon;

  return (
    <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2', tone.cls)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-[11px] font-bold">
          <MessageSquare className="h-3 w-3" /> {state.label}
        </p>
        <p className="mt-0.5 text-[10px] leading-snug opacity-80">{state.detail}</p>
      </div>
    </div>
  );
}