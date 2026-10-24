import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';
import AdminPage from '@/components/admin/ui/AdminPage';
import AdminSection from '@/components/admin/ui/AdminSection';
import ErrorState from '@/components/states/ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

// Starting values for a first save only. The engine reads the saved record and has no defaults of its own.
const DEFAULTS = {
  enabled: false, new_client_deposit_amount: 20, after_hours_deposit_amount: 20,
  deposit_type: 'fixed', deposit_amount: 20, group_min_people: 4,
  min_no_shows: 2, no_show_deposit_amount: 20, link_expiry_hours: 24, allow_waive: true,
};
const FIELDS = Object.keys(DEFAULTS);

const Row = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <div className="min-w-0"><p className="text-sm text-zinc-900">{label}</p>{hint && <p className="text-xs text-zinc-500">{hint}</p>}</div>
    <div className="shrink-0">{children}</div>
  </div>
);

export default function DepositRules() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => {
    setError(false);
    base44.entities.DepositRules.list('-created_date', 1).then((res) => {
      const rec = (Array.isArray(res) ? res : res?.items || [])[0];
      setForm({ ...DEFAULTS, ...(rec || {}) });
    }).catch(() => setError(true));
  };
  useEffect(load, []);

  if (error) return <div className="p-6"><ErrorState title="Couldn't load deposit rules" description="Please try again." onRetry={load} /></div>;
  if (!form) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k) => (e) => set(k, e.target.value === '' ? 0 : Number(e.target.value));
  const money = (k, label, hint) => (
    <Row label={label} hint={hint}><Input type="number" min="0" value={form[k]} onChange={num(k)} className="w-24" /></Row>
  );

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const data = Object.fromEntries(FIELDS.map((k) => [k, form[k]]));
      await saveSettings('DepositRules', 'deposits', data);
      setMsg({ ok: true, text: 'Deposit rules saved. They apply to the next booking.' });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Could not save the deposit rules.' });
    }
    setSaving(false);
  };

  return (
    <AdminPage title="Deposit Rules" subtitle="Decide which bookings need a deposit and how much. Every value here is used exactly as saved. Payments are simulated until a payment account is connected.">
      <AdminSection title="Deposits">
        <Row label="Require deposits" hint="Off = no booking ever needs a deposit."><Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} /></Row>
        <Row label="Admins can waive a deposit" hint="A reason is always required and recorded."><Switch checked={form.allow_waive} onCheckedChange={(v) => set('allow_waive', v)} /></Row>
        {money('link_expiry_hours', 'Payment link expires after (hours)')}
      </AdminSection>
      <AdminSection title="When a deposit is required" description="Each rule asks for its own amount; $0 turns a rule off. If several apply, the largest amount is used.">
        {money('new_client_deposit_amount', 'New client deposit ($)', 'Client has no earlier completed booking.')}
        {money('after_hours_deposit_amount', 'After-hours booking deposit ($)', 'Booking is outside normal hours.')}
        {money('min_no_shows', 'Earlier no-shows needed', 'Counted from recorded no-shows. 0 turns this off.')}
        {money('no_show_deposit_amount', 'No-show deposit ($)', 'Always asked once the no-show count is reached.')}
        {money('group_min_people', 'Group size needed (people)', '0 turns the group rule off.')}
        <Row label="Group deposit type">
          <select value={form.deposit_type} onChange={(e) => set('deposit_type', e.target.value)} className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm">
            <option value="fixed">Fixed amount ($)</option>
            <option value="percentage">Percentage of price (%)</option>
          </select>
        </Row>
        {money('deposit_amount', form.deposit_type === 'percentage' ? 'Group deposit (%)' : 'Group deposit ($)', 'Never more than the booking price.')}
      </AdminSection>
      {msg && <div role="status" className={`rounded-lg border p-3 text-sm ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{msg.text}</div>}
      <Button onClick={save} disabled={saving} className="w-full sm:w-auto">{saving ? 'Saving…' : 'Save deposit rules'}</Button>
    </AdminPage>
  );
}