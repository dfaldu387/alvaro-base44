import React from 'react';
import { Loader2 } from 'lucide-react';

/** Result of the real renderer. A blank or missing value is shown as "would not be sent", never as an empty gap. */
export default function TemplatePreview({ preview }) {
  const { result, failed, loading } = preview;
  if (loading) return <p className="text-xs text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Updating preview…</p>;
  if (failed) return <p className="text-xs text-red-600">Preview unavailable. Try again.</p>;
  if (!result?.ok) {
    const miss = result?.missing?.length ? ` Missing or blank value: ${result.missing.join(', ')}.` : '';
    return <p role="alert" className="text-xs text-red-600 break-words">Would not be sent: {result?.reason || 'unknown problem'}.{miss}</p>;
  }
  return (
    <div>
      <p className="text-xs text-zinc-800 leading-relaxed bg-white border border-zinc-200 rounded-lg p-2.5 break-words">{result.text}</p>
      <p className="text-[10px] text-zinc-500 mt-1">Test mode — not delivered. Preview only; nothing is queued or sent.</p>
    </div>
  );
}