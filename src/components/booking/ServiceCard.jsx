import React from 'react';
import { Scissors, Plus, Minus } from 'lucide-react';

const MAX_TOTAL = 6;

export default function ServiceCard({ service, quantity, onIncrease, onDecrease, totalItems }) {
  const active = quantity > 0;
  const atTotalMax = totalItems >= MAX_TOTAL;
  const increaseDisabled = atTotalMax;

  return (
    <div className={`rounded-2xl border transition-all overflow-hidden ${active ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'}`}>
      <div className="flex gap-3 p-4 items-center">
        {/* Thumbnail */}
        <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-muted flex items-center justify-center">
          {service.photo_url ? (
            <img src={service.photo_url} alt={service.name} className="w-full h-full object-cover" />
          ) : (
            <Scissors className="w-6 h-6 text-muted-foreground" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm leading-tight">{service.name}</p>
          <p className="text-primary font-bold text-base mt-0.5">${service.price}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Approx. {service.duration_mins} mins</p>
        </div>

        {/* Quantity controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onDecrease}
            disabled={quantity === 0}
            className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:border-primary/50 hover:text-foreground transition-all"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className={`w-5 text-center text-sm font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}>
            {quantity}
          </span>
          <button
            onClick={onIncrease}
            disabled={increaseDisabled}
            className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:border-primary/50 hover:text-foreground transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}