import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ACTION_LABEL } from '@/lib/reminderMeta';

const Btn = ({ children, className, ...p }) => (
  <button {...p} className={cn('rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed', className)}>{children}</button>
);

/** Only offers actions that make sense for the card; the server re-checks every one. */
export default function ReminderActions({ card, busy, onAction }) {
  const act = (a) => () => onAction(a, card);
  const open = card.column === 'due' || card.column === 'follow_up';
  return (
    <div className="flex flex-wrap gap-1 pt-2">
      {open && <Btn disabled={busy || !card.can_send_now} title={card.send_blocked || ''} onClick={act('send_now')} className="border-indigo-300 text-indigo-700">{ACTION_LABEL.send_now}</Btn>}
      {open && <Btn disabled={busy} onClick={act('skip_cycle')}>{ACTION_LABEL.skip_cycle}</Btn>}
      {!card.paused && <Btn disabled={busy} onClick={act('pause')}>{ACTION_LABEL.pause}</Btn>}
      {card.column !== 'booked' && <Btn disabled={busy} onClick={act('mark_booked')}>{ACTION_LABEL.mark_booked}</Btn>}
      <Link to={`/admin/messages?client=${card.client_id}`} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50">Open conversation</Link>
    </div>
  );
}