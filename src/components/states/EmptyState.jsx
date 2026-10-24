import React from 'react';
import { Inbox } from 'lucide-react';

// Empty state with optional action button. Use `filtered` to differentiate
// "no results match filters" from "no data exists yet".
export default function EmptyState({
  icon: IconProp,
  title = 'Nothing here yet',
  description = '',
  actionLabel,
  onAction,
  filtered = false,
  className = '',
}) {
  const Icon = IconProp || Inbox;
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${filtered ? 'bg-muted/50' : 'bg-primary/10'}`}>
        <Icon className={`w-5 h-5 ${filtered ? 'text-muted-foreground' : 'text-primary'}`} />
      </div>
      <p className="text-sm font-bold text-foreground mb-1">{title}</p>
      {description && <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">{description}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 h-10 px-5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}