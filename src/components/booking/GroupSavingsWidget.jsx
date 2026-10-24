import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getApplicableTier } from '@/lib/groupPricing';

// Group booking = 2+ people at the same location. Tier labels and amounts are
// driven entirely by the configurable GroupDiscountSettings (business default).
// When discounts are disabled, this widget renders nothing.
const TIER_KEYS = ['2', '3', '4+'];
const TIER_LABELS = { '2': '2 People', '3': '3 People', '4+': '4+ People' };

function tierConfigByKey(settings, key) {
  if (key === '2') return { type: settings.tier_2_type, amount: settings.tier_2_amount };
  if (key === '3') return { type: settings.tier_3_type, amount: settings.tier_3_amount };
  return { type: settings.tier_4plus_type, amount: settings.tier_4plus_amount };
}

function minPeopleForKey(key) {
  return key === '4+' ? 4 : Number(key);
}

function savingLabel(cfg) {
  if (!cfg || !cfg.amount) return 'No discount';
  return cfg.type === 'percentage' ? `Save ${cfg.amount}%` : `Save $${cfg.amount}`;
}

export default function GroupSavingsWidget({ peopleCount, settings }) {
  const prevTierRef = useRef(null);
  const [toast, setToast] = useState(null);
  const [animKey, setAnimKey] = useState(0);

  const activeTier = getApplicableTier(peopleCount, settings);

  useEffect(() => {
    const newKey = activeTier ? activeTier.tier : null;
    const prev = prevTierRef.current;
    if (newKey !== null && newKey !== prev) {
      const cfg = tierConfigByKey(settings, newKey);
      setToast({ message: '✨ Group Savings Unlocked', subMessage: savingLabel(cfg) });
      setAnimKey(k => k + 1);
      const t = setTimeout(() => setToast(null), 3500);
      prevTierRef.current = newKey;
      return () => clearTimeout(t);
    }
    if (newKey === null) prevTierRef.current = null;
  }, [activeTier, settings]);

  // Don't render anything when discounts are disabled or settings not loaded.
  if (!settings || settings.enabled === false) return null;

  return (
    <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Group Booking Savings</p>
          <p className="text-xs text-muted-foreground">Book 2 or more people at the same location and save.</p>
        </div>
      </div>

      {/* Tiers — fixed height, outcome-focused */}
      <div className="grid grid-cols-3 gap-2">
        {TIER_KEYS.map(key => {
          const cfg = tierConfigByKey(settings, key);
          const isActive = activeTier && peopleCount >= minPeopleForKey(key);
          return (
            <div
              key={key}
              className={`rounded-xl border px-2 py-1.5 text-center transition-all duration-300 ${
                isActive
                  ? 'border-primary/40 bg-primary/15 shadow-[0_0_10px_rgba(147,51,234,0.15)]'
                  : 'border-border bg-muted/30'
              }`}
            >
              <p className={`text-xs font-semibold leading-tight ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                {TIER_LABELS[key]}
              </p>
              <p className={`text-sm font-bold mt-1 ${isActive ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {savingLabel(cfg)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Toast — tier unlock animation */}
      <div className="h-7 relative">
        {toast && (
          <div
            key={animKey}
            className="absolute inset-0 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-3"
            style={{ animation: 'savingsReveal 0.35s ease-out' }}
          >
            <span className="text-xs font-semibold text-primary">{toast.message}</span>
            <span className="text-xs font-medium text-primary/80">{toast.subMessage}</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes savingsReveal {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}