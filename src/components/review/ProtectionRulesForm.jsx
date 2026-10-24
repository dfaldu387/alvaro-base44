import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';
import AdminSection from '@/components/admin/ui/AdminSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

// Starting values used until the first save. 0 turns a check off.
const DEFAULTS = {
  enabled: true, max_per_phone_hour: 10, max_per_email_hour: 10, max_per_ip_hour: 20,
  max_active_unconfirmed: 3, max_names_per_phone_day: 5, flag_outer_tier: true,
  repeat_declined_hours: 24, late_cancel_hours: 24,
};
const NUMBERS = [
  ['max_per_phone_hour', 'Requests per phone number, per hour', 'Matched whatever formatting was typed.'],
  ['max_per_email_hour', 'Requests per email address, per hour'],
  ['max_per_ip_hour', 'Requests per connection, per hour', 'Higher, because many people can share one connection.'],
  ['max_active_unconfirmed', 'Open unconfirmed bookings per customer', 'Held bookings do not count.'],
  ['max_names_per_phone_day', 'Different names per phone number, per 24 hours'],
  ['repeat_declined_hours', 'Hold an exact repeat of a declined request for (hours)'],
  ['late_cancel_hours', 'Cancellation counts as late inside (hours before the appointment)'],
];

const Row = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <div className="min-w-0"><p className="text-sm text-zinc-900">{label}</p>{hint && <p className="text-xs text-zinc-500">{hint}</p>}</div>
    <div className="shrink-0">{children}</div>
  </div>
);

export default function ProtectionRulesForm() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    base44.entities.BookingProtectionRules.list('-created_date', 1).then((res) => {
      const rec = (Array.isArray(res) ? res : res?.items || [])[0];
      setForm({ ...DEFAULTS, ...(rec || {}) });
    }).catch(() => setMsg({ ok: false, text: 'Could not load the protection limits.' }));
  }, []);

  if (!form) return <p className="text-sm text-zinc-500">{msg ? msg.text : 'Loading limits…'}</p>;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const data = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, form[k]]));
      await saveSettings('BookingProtectionRules', 'limits', data);
      setMsg({ ok: true, text: 'Limits saved. They apply to the next booking.' });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Could not save the limits.' });
    }
    setSaving(false);
  };

  return (
    <AdminSection title="Protection limits" description="Going over a limit never rejects a booking. It is held here for you to approve or decline. 0 turns a check off.">
      <Row label="Booking protection" hint="Off = nothing is ever held."><Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} /></Row>
      {NUMBERS.map(([k, label, hint]) => (
        <Row key={k} label={label} hint={hint}>
          <Input type="number" min="0" value={form[k]} onChange={(e) => set(k, e.target.value === '' ? 0 : Number(e.target.value))} className="w-24" />
        </Row>
      ))}
      <Row label="Hold addresses in the outer service ring" hint="A person checks they are reachable."><Switch checked={form.flag_outer_tier} onCheckedChange={(v) => set('flag_outer_tier', v)} /></Row>
      {msg && <div role="status" className={`mt-2 rounded-lg border p-3 text-sm ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{msg.text}</div>}
      <Button onClick={save} disabled={saving} className="mt-3 w-full sm:w-auto">{saving ? 'Saving…' : 'Save limits'}</Button>
    </AdminSection>
  );
}