import React, { useState } from 'react';
import { Check, X, Pencil, ChevronDown, AlertCircle } from 'lucide-react';

// One person in a booking. Primary service is single-select (radio style);
// add-ons are multi-select and kept separate from the primary service.
// A person never counts as more than one person regardless of add-ons.
//
// Each participant card has an expanded/collapsed UI state:
//  - expanded: full service + add-on lists, with a Done button
//  - collapsed: compact summary (service, add-ons, price, duration, Edit)
// The expanded state is owned by the parent so it can coordinate which
// cards are open; selection state is always preserved across collapse.
export default function PersonCard({
  index,
  services,
  addons,
  primaryServiceId,
  addonIds,
  expanded,
  onSelectPrimary,
  onToggleAddon,
  onRemove,
  onDone,
  onEdit,
  canRemove,
  incomplete,
}) {
  const primary = services.find(s => s.id === primaryServiceId) || null;
  const selectedAddons = addonIds
    .map(id => addons.find(a => a.id === id))
    .filter(Boolean);

  const price = (primary ? primary.price : 0)
    + selectedAddons.reduce((sum, a) => sum + (a.price_adjustment || 0), 0);
  const duration = (primary ? primary.duration_mins : 0)
    + selectedAddons.reduce((sum, a) => sum + (a.duration_adjustment || 0), 0);

  const [addonsExpanded, setAddonsExpanded] = useState(false);
  const addonCount = selectedAddons.length;
  const addonPriceTotal = selectedAddons.reduce((sum, a) => sum + (a.price_adjustment || 0), 0);

  // ── Collapsed: compact summary ───────────────────────────────
  if (!expanded) {
    const addonLabel = selectedAddons.length > 0
      ? ` + ${selectedAddons.map(a => a.name).join(', ')}`
      : '';
    return (
      <div className={`rounded-2xl border bg-card overflow-hidden ${incomplete ? 'border-amber-500/50' : 'border-border'}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 min-w-0 text-left"
            aria-label={`Edit person ${index + 1}`}
          >
            <p className="text-sm font-semibold text-foreground truncate">
              Person {index + 1} — {primary ? `${primary.name}${addonLabel}` : 'No service selected'}
            </p>
            {incomplete ? (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-500 mt-0.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" /> Service required
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">
                {primary ? `$${price} · ${duration} mins` : 'Tap to choose a service'}
              </p>
            )}
          </button>
          <div className="flex items-center gap-1 shrink-0 ml-3">
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors px-2 py-1"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
            {canRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={`Remove person ${index + 1}`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded: full service + add-on lists ────────────────────
  const canDone = !!primaryServiceId;
  return (
    <div className={`rounded-2xl border bg-card overflow-hidden ${incomplete ? 'border-amber-500/50' : 'border-primary/30'}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold text-foreground">Person {index + 1}</p>
          {incomplete && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-500 shrink-0">
              <AlertCircle className="w-3 h-3" /> Service required
            </span>
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={`Remove person ${index + 1}`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Primary service — single select */}
      <div className="divide-y divide-border">
        {services.map(s => {
          const selected = primaryServiceId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectPrimary(s.id)}
              className="flex items-center w-full px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>{s.name}</p>
                <p className="text-xs text-muted-foreground">${s.price} · {s.duration_mins} mins</p>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ml-3 transition-all ${
                selected ? 'bg-primary border-primary' : 'border-border'
              }`}>
                {selected && <div className="w-2.5 h-2.5 rounded-full bg-primary-foreground" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Add-ons — collapsible, multi select, separate from primary service */}
      {addons && addons.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setAddonsExpanded(v => !v)}
            className="flex items-center w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
            aria-expanded={addonsExpanded}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Add-ons</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {addonCount > 0
                  ? `${addonCount} selected · +$${addonPriceTotal}`
                  : 'Optional'}
              </p>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 ml-3 transition-transform duration-200 ${addonsExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-all duration-200 ease-in-out ${addonsExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
            <div className="overflow-hidden">
              <div className="divide-y divide-border">
                {addons.map(a => {
                  const selected = addonIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onToggleAddon(a.id)}
                      className="flex items-center w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          +${a.price_adjustment}
                          {a.duration_adjustment ? ` · +${a.duration_adjustment} mins` : ''}
                        </p>
                      </div>
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ml-3 transition-all ${
                        selected ? 'bg-primary border-primary' : 'border-border'
                      }`}>
                        {selected && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Done — collapses this participant once a primary service is chosen */}
      <div className="px-4 py-3 border-t border-border">
        <button
          type="button"
          disabled={!canDone}
          onClick={onDone}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-semibold py-2.5 hover:bg-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check className="w-4 h-4" /> Done
        </button>
        {!canDone && (
          <p className="text-xs text-muted-foreground text-center mt-1.5">Select a service to continue</p>
        )}
      </div>
    </div>
  );
}