import React from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One-click Favourite toggle (client-level flag).
 * Filled gold star = favourite, grey outlined star = normal.
 * tones: light (admin tables / panels), dark (calendar cards).
 * Clicks never bubble — on the calendar this also prevents drag-to-move.
 */
const TONES = {
  light: {
    on: 'bg-amber-50 hover:bg-amber-100',
    off: 'hover:bg-zinc-100',
    starOff: 'text-zinc-300',
  },
  dark: {
    on: 'bg-amber-400/15 hover:bg-amber-400/25',
    off: 'hover:bg-white/10',
    starOff: 'text-zinc-500',
  },
};

const SIZES = {
  xs: { btn: 'w-4 h-4', icon: 'w-2.5 h-2.5' },
  sm: { btn: 'w-6 h-6', icon: 'w-3.5 h-3.5' },
  md: { btn: 'w-8 h-8', icon: 'w-4 h-4' },
};

export default function FavouriteStar({ isFavourite, onToggle, name, tone = 'light', size = 'sm', className, starClassName }) {
  const t = TONES[tone] || TONES.light;
  const s = SIZES[size] || SIZES.sm;
  const on = isFavourite === true;

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      title={on ? 'Remove Favourite' : 'Add to Favourites'}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
      className={cn(
        'rounded-md flex items-center justify-center shrink-0 transition-colors',
        s.btn,
        on ? t.on : t.off,
        className
      )}
    >
      <Star className={cn(s.icon, on ? 'fill-amber-400 text-amber-400' : t.starOff, starClassName)} />
    </button>
  );
}