import React, { useEffect, useRef } from 'react';
import { X, CheckCircle, AlertTriangle } from 'lucide-react';

/**
 * A single self-dismissing toast. Parent controls mounting/unmounting.
 * Props: message, description, type ('success'|'error'|'info'), onDismiss, onUndo, duration (ms)
 */
export default function ScheduleToast({ message, description, type = 'success', onDismiss, onUndo, duration = 3000 }) {
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, duration);
    return () => clearTimeout(timerRef.current);
  }, [onDismiss, duration]);

  const Icon = type === 'error' ? AlertTriangle : CheckCircle;
  const iconColor = type === 'error' ? 'text-red-600' : 'text-emerald-600';

  return (
    <div
      className="flex items-start gap-3 bg-zinc-100 border border-zinc-200 rounded-2xl px-4 py-3 shadow-2xl min-w-[260px] max-w-xs pointer-events-auto"
      style={{ animation: 'slideInDown 0.2s ease-out' }}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 leading-tight">{message}</p>
        {description && <p className="text-xs text-zinc-900/60 mt-0.5 leading-snug">{description}</p>}
        {onUndo && (
          <button
            onClick={() => { clearTimeout(timerRef.current); onUndo(); onDismiss(); }}
            className="text-xs font-semibold text-primary mt-1 hover:text-primary/80 transition-colors"
          >
            Undo
          </button>
        )}
      </div>
      <button
        onClick={() => { clearTimeout(timerRef.current); onDismiss(); }}
        className="text-zinc-900/40 hover:text-zinc-900/80 transition-colors shrink-0 p-0.5"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Toast container — rendered at top of screen, non-blocking.
 * Usage: <ScheduleToastContainer toasts={toasts} onDismiss={id => ...} />
 * toasts: [{ id, message, description, type, onUndo }]
 */
export function ScheduleToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed top-4 left-0 right-0 z-[9999] flex flex-col items-center gap-2 pointer-events-none px-4"
      style={{ zIndex: 9999 }}
    >
      {toasts.map(t => (
        <ScheduleToast
          key={t.id}
          message={t.message}
          description={t.description}
          type={t.type}
          onUndo={t.onUndo}
          onDismiss={() => onDismiss(t.id)}
        />
      ))}
      <style>{`
        @keyframes slideInDown {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}