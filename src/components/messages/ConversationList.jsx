import React from 'react';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import { initials, timeSince } from '@/lib/reminderUtils';

/**
 * The conversation list: one row per client, styled like a phone's message list —
 * avatar, name, the last thing said, and when. Selecting a row opens the thread.
 */
export default function ConversationList({ conversations, selectedId, onSelect, hasMore, onLoadMore, searching }) {
  if (conversations.length === 0) {
    return <p className="p-6 text-center text-xs text-zinc-400">{searching ? 'No clients match that name.' : 'No messages yet.'}</p>;
  }
  return (
    <div className="py-1">
      {conversations.map((c) => {
        const selected = selectedId === c.clientId;
        return (
          <button
            key={c.clientId}
            onClick={() => onSelect(c.clientId)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150',
              selected ? 'bg-[#f3efff]' : 'hover:bg-zinc-50',
            )}
          >
            <div className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
              selected ? 'bg-[#7c3aed] text-white' : 'bg-zinc-100 text-zinc-600',
            )}>
              {initials(c.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900">{c.name}</p>
                {c.lastAt && <span className="shrink-0 text-[10px] text-zinc-400 tabular-nums">{timeSince(c.lastAt)}</span>}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {c.lastText ? `${c.lastDirection === 'outgoing' ? 'You: ' : ''}${c.lastText}` : 'No messages yet'}
              </p>
              {(c.isTest || c.optedOut || c.failed) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.isTest && <StatusBadge tone="test">TEST</StatusBadge>}
                  {c.optedOut && <StatusBadge tone="warning">OPTED OUT</StatusBadge>}
                  {c.failed && <StatusBadge tone="danger">FAILED</StatusBadge>}
                </div>
              )}
            </div>
          </button>
        );
      })}
      {hasMore && !searching && (
        <button onClick={onLoadMore} className="w-full py-3 text-xs font-semibold text-[#7c3aed] hover:bg-zinc-50">Load older conversations</button>
      )}
    </div>
  );
}