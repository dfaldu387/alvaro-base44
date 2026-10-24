import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';

// Admin configuration for group booking discounts. Loads and persists the
// business-default GroupDiscountSettings record (team_member_id = null).
// The structure (team_member_id field) supports future per-barber overrides
// without changing this component's shape.
const DEFAULTS = {
  enabled: true,
  max_group_booking_people: 6,
  tier_2_type: 'fixed',
  tier_2_amount: 10,
  tier_3_type: 'fixed',
  tier_3_amount: 21,
  tier_4plus_type: 'percentage',
  tier_4plus_amount: 10,
};

const TIERS = [
  { key: 'tier_2', label: '2 people' },
  { key: 'tier_3', label: '3 people' },
  { key: 'tier_4plus', label: '4+ people' },
];

export default function GroupDiscountSection() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    base44.entities.GroupDiscountSettings.list('-created_date', 50)
      .then(records => {
        const biz = (records || []).find(r => !r.team_member_id) || (records || [])[0] || null;
        if (biz) {
          setSettings({
            enabled: biz.enabled !== false,
            max_group_booking_people: biz.max_group_booking_people ?? 6,
            tier_2_type: biz.tier_2_type || 'fixed',
            tier_2_amount: biz.tier_2_amount ?? 10,
            tier_3_type: biz.tier_3_type || 'fixed',
            tier_3_amount: biz.tier_3_amount ?? 21,
            tier_4plus_type: biz.tier_4plus_type || 'percentage',
            tier_4plus_amount: biz.tier_4plus_amount ?? 10,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setSettings(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // Only the discount fields: the daily cap and the coverage radii belong to other screens.
      await saveSettings('GroupDiscountSettings', 'discounts', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore — button state resets below
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-4 text-center text-xs text-zinc-500">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-900">Enable Group Booking Discounts</p>
          <p className="text-xs text-zinc-500 mt-0.5">Apply automatic savings when 2+ people book together at the same location.</p>
        </div>
        <button
          onClick={() => set('enabled', !settings.enabled)}
          className={`w-11 h-6 rounded-full transition-colors shrink-0 relative before:content-[''] before:absolute before:inset-x-0 before:-inset-y-2.5 ${settings.enabled ? 'bg-indigo-600' : 'bg-zinc-300'}`}
        >
          <span className={`absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Maximum group size — always visible, independent of discount toggle */}
      <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-900">Maximum people per group booking</p>
        <p className="text-xs text-zinc-500">Customers cannot add more than this many participants in a single booking.</p>
        <input
          type="number"
          value={settings.max_group_booking_people}
          min={1}
          max={50}
          onChange={e => set('max_group_booking_people', Math.max(1, Number(e.target.value) || 1))}
          className="w-20 bg-white border border-zinc-300 rounded-lg px-2 py-1.5 max-sm:min-h-11 text-sm text-zinc-900 text-center outline-none"
        />
      </div>

      {/* Max bookings per day — drives public day-status (available / filling up / limited / full) */}
      <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-900">Maximum bookings per day</p>
        <p className="text-xs text-zinc-500">Caps how many booking requests are accepted per day. Days fill from "available" → "filling up" → "limited" → "full" as bookings approach this limit. Counts actual bookings, not add-ons.</p>
        <input
          type="number"
          value={settings.max_bookings_per_day}
          min={1}
          max={60}
          onChange={e => set('max_bookings_per_day', Math.max(1, Number(e.target.value) || 1))}
          className="w-20 bg-white border border-zinc-300 rounded-lg px-2 py-1.5 max-sm:min-h-11 text-sm text-zinc-900 text-center outline-none"
        />
      </div>

      {settings.enabled && (
        <div className="space-y-3">
          {TIERS.map(t => (
            <div key={t.key} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-zinc-900">{t.label}</p>
              <div className="flex items-center gap-2">
                <select
                  value={settings[`${t.key}_type`]}
                  onChange={e => set(`${t.key}_type`, e.target.value)}
                  className="flex-1 bg-white border border-zinc-300 rounded-lg px-2 py-1.5 max-sm:min-h-11 text-sm text-zinc-900 outline-none"
                >
                  <option value="fixed">Fixed $</option>
                  <option value="percentage">Percentage %</option>
                </select>
                <input
                  type="number"
                  value={settings[`${t.key}_amount`]}
                  min={0}
                  onChange={e => set(`${t.key}_amount`, Number(e.target.value))}
                  className="w-20 bg-white border border-zinc-300 rounded-lg px-2 py-1.5 max-sm:min-h-11 text-sm text-zinc-900 text-center outline-none"
                />
                <span className="text-xs text-zinc-500 w-4 text-right">
                  {settings[`${t.key}_type`] === 'percentage' ? '%' : '$'}
                </span>
              </div>
            </div>
          ))}
          <p className="text-xs text-zinc-500">Changes apply to future bookings only — existing bookings keep their original totals.</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`text-sm font-bold px-5 py-2 max-sm:min-h-11 rounded-xl transition-all ${saved ? 'bg-green-600 text-white' : 'bg-zinc-900 text-white hover:opacity-90'}`}
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}