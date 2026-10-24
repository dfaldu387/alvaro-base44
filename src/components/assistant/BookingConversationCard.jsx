import React from 'react';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import { when } from '@/lib/conversations';

const STATUS = {
  drafting: { label: 'Offer waiting for you', tone: 'warning' },
  offered: { label: 'Offered', tone: 'neutral' },
  booked: { label: 'Booked', tone: 'success' },
  escalated: { label: 'Handed to you', tone: 'warning' },
  closed: { label: 'Closed', tone: 'neutral' },
};

/** The booking this conversation created, with the time the customer was told beside the time it has now. */
function BookingLine({ booking, convoId }) {
  const promised = booking.assistant_promised_time;
  const moved = promised && booking.assigned_time && promised !== booking.assigned_time;
  return (
    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5 space-y-0.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Booking created from this conversation</p>
      <p className="text-sm text-zinc-800 break-words">
        {booking.requested_date} · promised {promised || 'n/a'} · now {booking.assigned_time || 'unplaced'} · {booking.status}
      </p>
      {moved && <p className="text-xs font-semibold text-red-700">The time has changed since the customer was told.</p>}
      <p className="text-[11px] text-zinc-400 break-all">Booking {booking.id} ← conversation {convoId}</p>
    </div>
  );
}

/** One assistant booking conversation: what was asked, what was offered, the messages, the booking, every step. */
export default function BookingConversationCard({ item }) {
  const { convo, booking, events } = item;
  const meta = STATUS[convo.status] || STATUS.closed;
  const c = convo.constraint || {};
  return (
    <details className="rounded-xl border border-zinc-200 bg-white" open={convo.status !== 'closed' && convo.status !== 'booked' ? true : undefined}>
      <summary className="px-3 py-2.5 flex flex-wrap items-center gap-1.5 cursor-pointer min-h-[44px]">
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        <span className="text-xs text-zinc-700">Asked for {c.weekday || c.date || 'a day'}{c.earliest ? ` after ${c.earliest}` : ''}{c.latest ? ` before ${c.latest}` : ''}</span>
        <span className="text-[11px] text-zinc-400 ml-auto">{when(convo.created_date)}</span>
      </summary>
      <div className="px-3 pb-3 space-y-2.5">
        {events.map((e) => (
          <div key={e.id} className="space-y-1 min-w-0">
            <p className="text-sm text-zinc-800 whitespace-pre-wrap break-words">Customer: “{e.inbound_text}”</p>
            {e.draft_text && <p className="text-xs text-zinc-600 whitespace-pre-wrap break-words pl-3 border-l-2 border-indigo-200">Reply: {e.draft_text}</p>}
          </div>
        ))}
        {convo.offered_slots?.length > 0 && (
          <p className="text-xs text-zinc-600">Offered: {convo.offered_slots.map((s) => `${s.label} ${s.date}`).join(' · ')}</p>
        )}
        {convo.accepted_slot && <p className="text-xs font-semibold text-zinc-800">Accepted: {convo.accepted_slot.label} {convo.accepted_slot.date}</p>}
        {booking && <BookingLine booking={booking} convoId={convo.id} />}
        {!booking && convo.status === 'booked' && <p className="text-xs text-red-700">Marked booked, but no booking is linked to it.</p>}
        {convo.log?.length > 0 && (
          <ol className="text-[11px] text-zinc-500 space-y-0.5 list-decimal pl-4">
            {convo.log.map((l, i) => <li key={i} className="break-words">{l.step}: {l.detail}</li>)}
          </ol>
        )}
      </div>
    </details>
  );
}