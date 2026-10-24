import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';

// Booking Window — the one place that decides how soon and how far ahead a
// booking may be made. Persisted as the single BookingRules record and read by
// public booking, Route Flow and Calendar validation alike, so changing a value
// here changes every surface with no code change.
const DEFAULTS = {
  minimum_notice_hours: 24,
  maximum_booking_days: 30,
};

export default function BookingWindowSection() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    base44.entities.BookingRules.list('-created_date', 1)
      .then(records => {
        const record = (records || [])[0] || null;
        if (record) {
          setSettings({
            minimum_notice_hours: record.minimum_notice_hours ?? DEFAULTS.minimum_notice_hours,
            maximum_booking_days: record.maximum_booking_days ?? DEFAULTS.maximum_booking_days,
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
      const payload = {
        minimum_notice_hours: Math.min(Math.max(Number(settings.minimum_notice_hours) || 0, 0), 336),
        maximum_booking_days: Math.min(Math.max(Math.round(Number(settings.maximum_booking_days) || 1), 1), 365),
      };
      await saveSettings('BookingRules', 'window', payload);
      setSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore — the button state resets below
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-4 text-center text-xs text-zinc-500">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-zinc-900 flex-1">Minimum notice</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={settings.minimum_notice_hours}
            min={0}
            max={336}
            onChange={e => set('minimum_notice_hours', Number(e.target.value))}
            className="w-20 bg-white border border-zinc-300 rounded-lg px-2 py-1.5 max-sm:min-h-11 text-sm text-zinc-900 text-center outline-none"
          />
          <span className="text-xs text-zinc-500 w-10">hours</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-zinc-900 flex-1">Customers can book up to</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={settings.maximum_booking_days}
            min={1}
            max={365}
            onChange={e => set('maximum_booking_days', Number(e.target.value))}
            className="w-20 bg-white border border-zinc-300 rounded-lg px-2 py-1.5 max-sm:min-h-11 text-sm text-zinc-900 text-center outline-none"
          />
          <span className="text-xs text-zinc-500 w-10">days</span>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        These rules apply to public bookings, Route Flow and Calendar validation. 0 hours allows same-day bookings.
      </p>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`text-sm font-bold px-5 py-2 max-sm:min-h-11 rounded-xl transition-all ${saved ? 'bg-green-600 text-white' : 'bg-zinc-900 text-white hover:opacity-90'}`}
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Window'}
        </button>
      </div>
    </div>
  );
}