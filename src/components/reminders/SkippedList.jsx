import React from 'react';
import { Link } from 'react-router-dom';
import { fmtDate } from '@/lib/reminderMeta';

/** Clients left out of the board, each with the reason. They are never hidden. */
export default function SkippedList({ skipped, open }) {
  return (
    <details open={open} key={String(open)} className="rounded-xl border border-zinc-200 bg-white">
      <summary className="cursor-pointer p-3 text-sm font-bold text-zinc-900">Skipped clients ({skipped.length})</summary>
      {skipped.length === 0 ? <p className="px-3 pb-3 text-sm text-zinc-500">No clients were skipped.</p> : (
        <ul className="divide-y divide-zinc-100">
          {skipped.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="text-sm font-semibold text-zinc-900">{s.name}</span>
              <span className="text-xs text-zinc-500 flex-1 min-w-[200px]">{s.reason_text}{s.next_reminder_date ? ` · reminder date ${fmtDate(s.next_reminder_date)}` : ''}</span>
              <Link to={`/admin/messages?client=${s.client_id}`} className="text-xs font-semibold text-indigo-600">Open conversation</Link>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}