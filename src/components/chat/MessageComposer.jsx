import React from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The composer, the same in every conversation: a rounded pill to type in, a round
 * send button that only lights up once there is something to send, and — when given
 * — quick replies as small chips above it. Enter sends.
 */
export default function MessageComposer({
  value, onChange, onSend,
  placeholder = 'Message',
  disabled = false, busy = false, maxLength = 640,
  quickReplies = [], hint,
}) {
  const canSend = value.trim().length > 0 && !disabled && !busy;
  const submit = (e) => {
    e.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div className="border-t border-zinc-100 bg-white px-3 pb-3 pt-2">
      {quickReplies.length > 0 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {quickReplies.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onChange(q)}
              disabled={disabled || busy}
              className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 transition-colors duration-150 hover:border-[#7c3aed]/40 hover:bg-[#f7f4ff] disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="mb-1.5 px-1 text-[10px] text-amber-700">{hint}</p>}
      <form onSubmit={submit} className="flex items-end gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          className="h-9 min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors duration-150 focus:border-[#7c3aed]/40 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/15 disabled:bg-zinc-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-all duration-150',
            canSend ? 'scale-100 bg-[#7c3aed] hover:bg-[#6d28d9]' : 'scale-95 bg-zinc-300',
          )}
        >
          {busy
            ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            : <ArrowUp className="h-4 w-4" strokeWidth={2.6} />}
        </button>
      </form>
    </div>
  );
}