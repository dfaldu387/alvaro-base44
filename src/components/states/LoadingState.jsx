import React from 'react';

// Skeleton loading state. Pass `lines` for a text block, or `cards` for card
// placeholders, or `rows` for table-row placeholders.
export default function LoadingState({ lines, cards, rows, className = '' }) {
  if (cards) {
    return (
      <div className={`grid gap-3 ${className}`} aria-busy="true" aria-live="polite">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 animate-pulse">
            <div className="h-4 w-1/3 bg-muted rounded mb-3" />
            <div className="h-3 w-2/3 bg-muted/60 rounded mb-2" />
            <div className="h-3 w-1/2 bg-muted/40 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (rows) {
    return (
      <div className={`divide-y divide-border ${className}`} aria-busy="true" aria-live="polite">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-3 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/4 bg-muted rounded" />
              <div className="h-3 w-1/3 bg-muted/60 rounded" />
            </div>
            <div className="h-6 w-16 bg-muted/60 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className}`} aria-busy="true" aria-live="polite">
      <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin mb-3" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}