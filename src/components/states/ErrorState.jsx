import React from 'react';
import { AlertCircle } from 'lucide-react';

// Error state with retry. Use for failed data loads. Preserves any entered
// data since this is a standalone card, not a form replacement.
export default function ErrorState({
  title = 'Something went wrong',
  description = 'Please try again.',
  retryLabel = 'Retry',
  onRetry,
  className = '',
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center mb-3">
        <AlertCircle className="w-5 h-5 text-destructive" />
      </div>
      <p className="text-sm font-bold text-foreground mb-1">{title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 h-10 px-5 rounded-xl bg-secondary border border-border text-foreground text-sm font-bold hover:bg-secondary/80 transition-colors"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}