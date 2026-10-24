import React from 'react';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/reminderMeta';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import CadenceNote from '@/components/clients/CadenceNote';
import ReminderActions from '@/components/reminders/ReminderActions';

const Row = ({ label, children }) => children ? (
  <p className="text-[11px] text-zinc-500"><span className="text-zinc-400">{label}: </span>{children}</p>
) : null;

export default function ReminderCard({ card, busy, onAction }) {
  const bad = ['failed', 'dead_letter', 'enqueue_failed'].includes(card.state);
  return (
    <div className={cn('rounded-lg border bg-white p-3 space-y-1', bad ? 'border-red-300' : 'border-zinc-200')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-zinc-900 break-words">{card.name}</p>
        <StatusBadge status={card.state} className="shrink-0">{card.state_label}</StatusBadge>
      </div>
      <Row label="Frequency">{card.frequency}</Row>
      <CadenceNote cadence={card.cadence} clientId={card.client_id} />
      <Row label="Last visit">{fmtDate(card.last_visit) || 'not recorded'}</Row>
      <Row label="Last campaign message">{fmtDate(card.last_message_at) || 'none this week'}</Row>
      <Row label="Last reply">{card.last_reply_at ? `${fmtDate(card.last_reply_at)}: “${card.last_reply_text}”` : 'none'}</Row>
      {card.messages.length > 1 && <Row label="Messages">{card.messages.map((m) => `${m.stage === 'outreach' ? 'Reminder' : 'Follow-up'} ${m.label.toLowerCase()}`).join(' · ')}</Row>}
      {card.reason && <p className={cn('text-[11px] break-words', bad ? 'text-red-600 font-semibold' : 'text-zinc-600')}>{card.reason}</p>}
      {card.note && <p className="text-[11px] text-zinc-600">{card.note}</p>}
      {(card.paused || card.opted_out) && <p className="text-[11px] font-semibold text-amber-700">{[card.paused && 'Reminders paused', card.opted_out && 'Opted out of messages'].filter(Boolean).join(' · ')}</p>}
      {card.send_blocked && <p className="text-[10px] text-zinc-400">{card.send_blocked}</p>}
      <ReminderActions card={card} busy={busy} onAction={onAction} />
    </div>
  );
}