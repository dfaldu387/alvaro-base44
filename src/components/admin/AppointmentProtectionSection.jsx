import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';
import { Shield, Check } from 'lucide-react';

const DEFAULTS = {
  auto_lock_confirmed: true,
  allow_manual_move_locked: true,
  allow_manual_move_confirmed: true,
};

export default function AppointmentProtectionSection() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    base44.entities.SchedulingSettings.list('-created_date', 1)
      .then(records => {
        if (records.length > 0) {
          setSettings({ ...DEFAULTS, ...records[0] });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setSettings(prev => ({ ...prev, [k]: v }));

  const handleSave = () => {
    setSaving(true);
    // The three protection switches only, never the record's own id and dates.
    const payload = {
      auto_lock_confirmed: settings.auto_lock_confirmed,
      allow_manual_move_locked: settings.allow_manual_move_locked,
      allow_manual_move_confirmed: settings.allow_manual_move_confirmed,
    };
    saveSettings('SchedulingSettings', 'protection', payload).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }).catch(() => {}).finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 mb-1">
        <Shield className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Control which appointments Auto Sort and manual editing can move. Protection status and availability are separate — locking or confirming never changes the customer's submitted availability window.
          </p>
        </div>
      </div>

      <ToggleRow
        label="Auto-lock confirmed appointments"
        sub="Confirmed appointments are protected from Auto Sort. This should normally stay enabled."
        value={settings.auto_lock_confirmed}
        onChange={v => set('auto_lock_confirmed', v)}
      />

      <ToggleRow
        label="Allow manual movement of locked appointments"
        sub="When enabled, require a warning before movement. When disabled, locked appointments cannot be dragged until manually unlocked."
        value={settings.allow_manual_move_locked}
        onChange={v => set('allow_manual_move_locked', v)}
      />

      <ToggleRow
        label="Allow manual movement of confirmed appointments"
        sub="When enabled, require a stronger warning. When disabled, confirmed appointments must first be changed out of Confirmed state before moving."
        value={settings.allow_manual_move_confirmed}
        onChange={v => set('allow_manual_move_confirmed', v)}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full text-sm font-bold py-2.5 max-sm:min-h-11 rounded-xl transition-all ${saved ? 'bg-green-600 text-white' : 'bg-zinc-900 text-white hover:opacity-90'} disabled:opacity-50`}
      >
        {saved ? '✓ Settings Saved' : saving ? 'Saving…' : 'Save Protection Settings'}
      </button>
    </div>
  );
}

function ToggleRow({ label, sub, value, onChange }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-900">{label}</p>
        {sub && <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{sub}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full transition-colors shrink-0 relative before:content-[''] before:absolute before:inset-x-0 before:-inset-y-2.5 ${value ? 'bg-indigo-600' : 'bg-zinc-300'}`}
      >
        <span className={`absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}