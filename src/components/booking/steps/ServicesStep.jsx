import React from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PersonCard from '@/components/booking/PersonCard';
import GroupSavingsWidget from '@/components/booking/GroupSavingsWidget';

// Step 2 — Services: "Who needs a cut?"
// Uses the existing participant-based booking model. Each participant selects
// exactly one primary service + optional add-ons. people_count = participants.length.
export default function ServicesStep({
  participants,
  collapsedIds,
  services,
  addons,
  groupDiscountSettings,
  onAddPerson,
  onRemovePerson,
  onSelectPrimary,
  onToggleAddon,
  onCollapsePerson,
  onExpandPerson,
  onContinue,
  loading,
  peopleCount,
  isGroupBooking,
  allHavePrimary,
  primaryServiceCount,
  addonCount,
  subtotal,
  totalMins,
  totalSavings,
  totalPrice,
  maxGroupPeople,
  atMaxPeople,
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="pb-48">
      <div className="mb-4">
        <h2 className="text-xl font-heading font-bold">Who needs a cut?</h2>
        <p className="text-sm text-muted-foreground mt-1">Choose a service for each person. Add more people to unlock group savings.</p>
      </div>

      <GroupSavingsWidget peopleCount={peopleCount} settings={groupDiscountSettings} />

      <div className="space-y-3">
        {participants.map((p, idx) => (
          <PersonCard
            key={p.id}
            index={idx}
            services={services}
            addons={addons}
            primaryServiceId={p.primary_service_id}
            addonIds={p.addon_ids}
            expanded={!collapsedIds.has(p.id)}
            onSelectPrimary={(sid) => onSelectPrimary(p.id, sid)}
            onToggleAddon={(aid) => onToggleAddon(p.id, aid)}
            onRemove={() => onRemovePerson(p.id)}
            onDone={() => onCollapsePerson(p.id)}
            onEdit={() => onExpandPerson(p.id)}
            canRemove={participants.length > 1}
            incomplete={!p.primary_service_id}
          />
        ))}
      </div>

      <button
        onClick={onAddPerson}
        disabled={atMaxPeople}
        className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-3.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary/5"
      >
        <Users className="w-4 h-4" /> Add another person
      </button>

      {atMaxPeople && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center">
          <p className="text-xs font-semibold text-primary">Maximum group size reached</p>
          <p className="text-xs text-muted-foreground mt-0.5">Up to {maxGroupPeople} people per booking.</p>
        </div>
      )}

      {/* Sticky summary */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-background/95 backdrop-blur border-t border-border p-4 max-w-md mx-auto">
        {primaryServiceCount > 0 && (
          <div className="space-y-1.5 mb-3">
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-foreground">
                {peopleCount} {peopleCount === 1 ? 'person' : 'people'}
                {addonCount > 0 ? ` · ${addonCount} ${addonCount === 1 ? 'add-on' : 'add-ons'}` : ''}
              </span>
              <span className="text-muted-foreground">~{totalMins} mins</span>
            </div>
            <div className="pt-1.5 border-t border-border space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal</span>
                <span>${subtotal}</span>
              </div>
              {totalSavings > 0 && (
                <div className="flex justify-between text-xs text-primary font-medium">
                  <span>Group Booking Savings</span>
                  <span>−${totalSavings}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-foreground">Total</span>
                <span className="font-bold text-primary">${totalPrice}</span>
              </div>
            </div>
          </div>
        )}
        {!allHavePrimary && (
          <p
            id="services-step-helper"
            role="status"
            className="text-sm text-muted-foreground text-center mb-3"
          >
            {peopleCount === 1
              ? 'Choose a service to continue.'
              : 'Choose a service for each person to continue.'}
          </p>
        )}
        <Button
          className="w-full"
          disabled={!allHavePrimary}
          onClick={onContinue}
          aria-describedby={allHavePrimary ? undefined : 'services-step-helper'}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}