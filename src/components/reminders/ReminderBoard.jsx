import React from 'react';
import { COLUMNS } from '@/lib/reminderMeta';
import ReminderCard from '@/components/reminders/ReminderCard';

/** Five columns of real campaign records. `filter` narrows every column to the clients behind a summary number. */
export default function ReminderBoard({ cards, filter, busyId, onAction }) {
  const shown = filter && filter !== 'skipped'
    ? cards.filter((c) => (filter === 'messaged_ok' ? ['queued', 'sent', 'delivered'].includes(c.state) : c.tags.includes(filter)))
    : cards;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const items = shown.filter((c) => c.column === col.key);
        return (
          <div key={col.key} className="min-w-[260px] flex-1 rounded-xl bg-zinc-100 p-2">
            <div className="px-1 pb-2">
              <p className="text-sm font-bold text-zinc-900">{col.title} <span className="text-zinc-400">({items.length})</span></p>
              <p className="text-[10px] text-zinc-500 leading-tight">{col.hint}</p>
            </div>
            <div className="space-y-2">
              {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-zinc-400">No clients</p>}
              {items.map((c) => <ReminderCard key={c.id} card={c} busy={busyId === c.id} onAction={onAction} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}