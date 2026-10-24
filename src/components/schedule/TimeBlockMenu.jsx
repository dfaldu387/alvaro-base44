import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * The one action menu every Calendar time block uses — appointments and blocked time
 * alike — so the three dots always sit in the same place and always open the same kind
 * of list. Items are plain objects: { label, icon, onSelect, danger, separator }.
 *
 * The trigger stops its own pointer events, so tapping the dots never starts a drag on
 * the card underneath it.
 */
export default function TimeBlockMenu({
  items = [], label = 'Actions', className, iconClassName, open, onOpenChange,
}) {
  if (items.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-violet-500 transition-colors hover:bg-white/80 hover:text-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
            className,
          )}
        >
          <MoreHorizontal className={cn('h-3.5 w-3.5', iconClassName)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="w-48">
        {items.map((item) => (item.separator ? (
          <DropdownMenuSeparator key={`sep-${item.label || 'x'}`} />
        ) : (
          <DropdownMenuItem
            key={item.label}
            onSelect={item.onSelect}
            className={cn(
              'gap-2 text-[13px] font-medium',
              item.danger && 'text-red-600 focus:bg-red-50 focus:text-red-700',
            )}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        )))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}