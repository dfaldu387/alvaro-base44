import React from 'react';
import { cn } from '@/lib/utils';

/**
 * One message, drawn the same way in every conversation in the app — the Messages
 * page, the Calendar's booking panel and the Route stop.
 *
 * A customer's message sits left in a soft grey bubble; a Cut Deluxe reply sits
 * right in brand purple. Channel, delivery and manual/automated are a quiet line
 * under the bubble rather than badges crowding the words, so a thread reads like a
 * conversation and not like a log.
 */
export default function ChatBubble({ incoming = false, text, at, meta = [], note }) {
  return (
    <div className={cn('flex w-full', incoming ? 'justify-start' : 'justify-end')}>
      <div className={cn('flex min-w-0 max-w-[80%] flex-col', incoming ? 'items-start' : 'items-end')}>
        <div
          className={cn(
            'whitespace-pre-wrap break-words px-3.5 py-2 text-[13px] leading-snug',
            incoming
              ? 'rounded-[18px] rounded-bl-[5px] bg-[#f0eff4] text-zinc-900'
              : 'rounded-[18px] rounded-br-[5px] bg-[#7c3aed] text-white',
          )}
        >
          {text}
        </div>
        {(at || meta.length > 0) && (
          <div className={cn('mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10px] leading-none text-zinc-400', incoming ? '' : 'justify-end')}>
            {meta.filter(Boolean).map((m, i) => (
              <span key={i} className="whitespace-nowrap">{m}</span>
            ))}
            {at && <span className="whitespace-nowrap tabular-nums">{at}</span>}
          </div>
        )}
        {note && <p className="mt-0.5 px-1 text-[10px] leading-tight text-amber-700">{note}</p>}
      </div>
    </div>
  );
}