import React, { useEffect, useState } from 'react';
import { saveSettings } from '@/lib/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const Field = ({ label, children }) => (
  <label className="block"><span className="text-xs font-semibold text-zinc-600">{label}</span><div className="mt-1">{children}</div></label>
);
const Pick = ({ value, onChange, options }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900">
    {options.map((o) => <option key={o}>{o}</option>)}
  </select>
);

/** Reads and saves the campaign settings on MessagingSettings (admin only). */
export default function CampaignSettingsForm({ settings, onSaved }) {
  const [f, setF] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setF(settings), [settings]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setError('');
    const data = {
      campaign_outreach_day: f.outreach_day, campaign_followup_day: f.followup_day,
      campaign_run_hour: Number(f.run_hour), campaign_timezone: String(f.timezone).trim(),
      campaign_max_per_run: Number(f.max_per_run),
      campaign_max_overdue_days: Number(f.max_overdue_days), campaign_booking_link: String(f.booking_link).trim(),
    };
    try {
      await saveSettings('MessagingSettings', 'campaign', data);
      onSaved();
    } catch (e) {
      setError(e?.message || 'Could not save the settings. Only admins can change them.');
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
      <h2 className="text-sm font-bold text-zinc-900">Settings</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Reminder day"><Pick value={f.outreach_day} onChange={set('outreach_day')} options={DAYS} /></Field>
        <Field label="Follow-up day"><Pick value={f.followup_day} onChange={set('followup_day')} options={DAYS} /></Field>
        <Field label="Run from (hour, 0-23)"><Input type="number" min="0" max="23" value={f.run_hour} onChange={(e) => set('run_hour')(e.target.value)} /></Field>
        <Field label="Timezone"><Input value={f.timezone} onChange={(e) => set('timezone')(e.target.value)} /></Field>
        <Field label="Max messages per run"><Input type="number" min="1" value={f.max_per_run} onChange={(e) => set('max_per_run')(e.target.value)} /></Field>
        <Field label="Skip if overdue by more than (days)"><Input type="number" min="1" value={f.max_overdue_days} onChange={(e) => set('max_overdue_days')(e.target.value)} /></Field>
        <div className="col-span-2"><Field label="Booking link used in messages"><Input value={f.booking_link} onChange={(e) => set('booking_link')(e.target.value)} /></Field></div>
      </div>
      <p className="text-xs text-zinc-500">Dry-run mode is changed only from the Dry-run section above, with a confirmation and a record of who changed it.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button onClick={save} disabled={saving} size="sm">{saving ? 'Saving…' : 'Save settings'}</Button>
    </div>
  );
}