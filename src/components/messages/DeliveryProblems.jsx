import React from 'react';
import { when } from '@/lib/conversations';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/admin/ui/StatusBadge';

/** Failed and dead-lettered messages in one list. Click a row to open that client's thread. */
export default function DeliveryProblems({ state, onSelect, kind }) {
  if (state.loading) return <p className="text-xs text-zinc-400 p-4">Loading…</p>;
  if (state.error) return <p className="text-xs text-red-600 p-4">Could not load delivery problems.</p>;
  const items = kind === 'dead' ? state.items.filter((i) => i.kind === 'Dead-lettered') : kind === 'failed' ? state.items.filter((i) => i.kind !== 'Dead-lettered') : state.items;
  if (items.length === 0) return <p className="text-xs text-zinc-400 p-4">No failed or dead-lettered messages.</p>;
  return (
    <div>
      {items.map((it) => (
        <button
          key={it.key}
          disabled={!it.clientId}
          onClick={() => onSelect(it.clientId)}
          className="w-full text-left px-3 py-2.5 border-b border-zinc-100 hover:bg-zinc-50 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-zinc-900 truncate flex-1">{it.name}</p>
            <StatusBadge tone={it.kind === 'Dead-lettered' ? 'danger' : 'warning'}>{it.kind}</StatusBadge>
          </div>
          <p className="text-xs text-red-600 mt-0.5 break-words">{it.reason}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{when(it.at)}</p>
        </button>
      ))}
    </div>
  );
}