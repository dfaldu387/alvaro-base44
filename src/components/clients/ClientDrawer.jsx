import React, { useEffect, useState } from 'react';
import { X, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import {
  FREQUENCY_OPTIONS, DAY_OPTIONS, SOURCE_OPTIONS, CATEGORY_OPTIONS, initialStageForSource,
  formatDateShort, initials,
} from '@/lib/reminderUtils';
import { cn } from '@/lib/utils';
import CadenceNote from '@/components/clients/CadenceNote';
import { explainCadence } from '@/lib/cadence';

export default function ClientDrawer({ client, isNew, onClose, onSave }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const existing = client && client.id;
    setForm(existing ? {
      client_name: client.client_name || '', phone: client.phone || '', email: client.email || '',
      address: client.address || '', suburb: client.suburb || '', postcode: client.postcode || '', usual_service: client.usual_service || '',
      scheduling_category: client.scheduling_category || '', manual_tags: (client.manual_tags || []).join(', '),
      frequency: client.frequency || 'Monthly', custom_frequency_days: client.custom_frequency_days || '',
      last_visit_date: client.last_visit_date || '', source: client.source || 'Reminder', is_paused: !!client.is_paused,
      recurring_enabled: !!client.recurring_enabled, recurring_frequency: client.recurring_frequency || '',
      recurring_day: client.recurring_day || '', recurring_time: client.recurring_time || '',
      recurring_window_start: client.recurring_window_start || '', recurring_window_end: client.recurring_window_end || '',
      recurring_service: client.recurring_service || '', recurring_address: client.recurring_address || '',
      recurring_weekly_confirmation: client.recurring_weekly_confirmation !== false,
      recurring_paused: !!client.recurring_paused, recurring_skip_cycle: !!client.recurring_skip_cycle,
      show_on_weekly_schedule: client.show_on_weekly_schedule !== false, next_cycle_date: client.next_cycle_date || '',
    } : {
      client_name: '', phone: '', email: '', address: '', suburb: '', postcode: '', usual_service: '',
      scheduling_category: '', manual_tags: '',
      frequency: 'Monthly', custom_frequency_days: '', last_visit_date: '', source: 'Reminder', is_paused: false,
      recurring_enabled: false, recurring_frequency: '', recurring_day: '', recurring_time: '',
      recurring_window_start: '', recurring_window_end: '',
      recurring_service: '', recurring_address: '', recurring_weekly_confirmation: true,
      recurring_paused: false, recurring_skip_cycle: false,
      show_on_weekly_schedule: true, next_cycle_date: '',
    });
  }, [client, isNew]);

  useEffect(() => {
    if (!client || isNew || !client.client_name) { setHistory([]); return; }
    base44.entities.BookingRequest.list('-created_date', 200).then(all => {
      setHistory(all.filter(r => (r.client_name || '').toLowerCase() === client.client_name.toLowerCase()).slice(0, 12));
    });
  }, [client, isNew]);

  if (!client) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.client_name.trim()) return;
    setSaving(true);
    const payload = {
      ...form,
      custom_frequency_days: form.custom_frequency_days ? Number(form.custom_frequency_days) : null,
      manual_tags: (form.manual_tags || '').split(',').map(t => t.trim()).filter(Boolean),
      scheduling_category: form.scheduling_category || null,
      recurring_frequency: form.recurring_enabled ? (form.recurring_frequency || '') : '',
    };
    // A frequency a person picks is a decision. An untouched "Monthly" on a new client is only a default.
    const picked = isNew ? form.frequency !== 'Monthly'
      : form.frequency !== client.frequency || Number(form.custom_frequency_days || 0) !== Number(client.custom_frequency_days || 0);
    if (picked) payload.cadence_source = 'manual';
    else if (isNew) payload.cadence_source = 'default';
    if (isNew) {
      payload.workflow_stage = initialStageForSource(form.source || 'Reminder', false);
    }
    try { await onSave(payload); } finally { setSaving(false); }
  };
  const createdLabel = client && client.created_date ? formatDateShort(client.created_date) : '';

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-[420px] bg-white border-l border-zinc-200 h-full overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-zinc-900">{isNew ? 'Add Client' : 'Edit Client'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-100">
          <div className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold">{initials(form.client_name)}</div>
          <div className="leading-tight">
            <p className="text-zinc-900 font-semibold">{form.client_name || 'New Client'}</p>
            {!isNew && createdLabel && <p className="text-xs text-zinc-400 mt-0.5">Client since {createdLabel}</p>}
          </div>
        </div>

        <div className="px-5 py-4 space-y-3.5 flex-1">
          <Field label="Name"><Input value={form.client_name || ''} onChange={e => set('client_name', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><Input value={form.phone || ''} onChange={e => set('phone', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
            <Field label="Email"><Input value={form.email || ''} onChange={e => set('email', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
          </div>
          <Field label="Address"><Input value={form.address || ''} onChange={e => set('address', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suburb"><Input value={form.suburb || ''} onChange={e => set('suburb', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
            <Field label="Postcode"><Input value={form.postcode || ''} onChange={e => set('postcode', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Usual Service"><Input value={form.usual_service || ''} onChange={e => set('usual_service', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
            <Field label="Availability Type"><Sel className="bg-white border-zinc-200" value={form.scheduling_category || '__none__'} onChange={v => set('scheduling_category', v === '__none__' ? '' : v)} options={['__none__', ...CATEGORY_OPTIONS]} labels={['Not configured', ...CATEGORY_OPTIONS]} /></Field>
          </div>
          <Field label="Manual tags (comma separated)"><Input value={form.manual_tags || ''} onChange={e => set('manual_tags', e.target.value)} placeholder="e.g. VIP, School Client" className="bg-white border-zinc-200 text-zinc-900" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency"><Sel className="bg-white border-zinc-200" value={form.frequency} onChange={v => set('frequency', v)} options={FREQUENCY_OPTIONS} /></Field>
            {form.frequency === 'Custom' && <Field label="Custom (days)"><Input type="number" value={form.custom_frequency_days || ''} onChange={e => set('custom_frequency_days', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>}
          </div>
          {!isNew && client.id && <CadenceNote cadence={explainCadence(client)} clientId={client.id} onAccepted={(d) => { set('frequency', 'Custom'); set('custom_frequency_days', d); }} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Last Visit"><Input type="date" value={form.last_visit_date || ''} onChange={e => set('last_visit_date', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
            <Field label="Source"><Sel className="bg-white border-zinc-200" value={form.source} onChange={v => set('source', v)} options={SOURCE_OPTIONS} /></Field>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5">
            <div><p className="text-sm font-medium text-zinc-800">Pause reminders</p><p className="text-xs text-zinc-400">Hide from reminder lists and workflow</p></div>
            <Switch checked={!!form.is_paused} onCheckedChange={v => set('is_paused', v)} />
          </div>

          {/* Recurring booking */}
          <div className="rounded-lg border border-zinc-200 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium text-zinc-800">Recurring booking</p><p className="text-xs text-zinc-400">Auto-create a draft request each cycle</p></div>
              <Switch checked={!!form.recurring_enabled} onCheckedChange={v => set('recurring_enabled', v)} />
            </div>
            {form.recurring_enabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Frequency"><Sel className="bg-white border-zinc-200" value={form.recurring_frequency || '__none__'} onChange={v => set('recurring_frequency', v === '__none__' ? '' : v)} options={['__none__', ...FREQUENCY_OPTIONS]} labels={['—', ...FREQUENCY_OPTIONS]} /></Field>
                  <Field label="Usual Day"><Sel className="bg-white border-zinc-200" value={form.recurring_day || '__none__'} onChange={v => set('recurring_day', v === '__none__' ? '' : v)} options={['__none__', ...DAY_OPTIONS]} labels={['—', ...DAY_OPTIONS]} /></Field>
                </div>
                <Field label="Usual Time (Fixed Time)"><Input value={form.recurring_time || ''} onChange={e => set('recurring_time', e.target.value)} placeholder="e.g. 5:30pm" className="bg-white border-zinc-200 text-zinc-900" /></Field>
                {form.scheduling_category === 'Fixed Window' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Window Start"><Input value={form.recurring_window_start || ''} onChange={e => set('recurring_window_start', e.target.value)} placeholder="e.g. 16:00" className="bg-white border-zinc-200 text-zinc-900" /></Field>
                    <Field label="Window End"><Input value={form.recurring_window_end || ''} onChange={e => set('recurring_window_end', e.target.value)} placeholder="e.g. 19:00" className="bg-white border-zinc-200 text-zinc-900" /></Field>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Default Service"><Input value={form.recurring_service || ''} onChange={e => set('recurring_service', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                  <Field label="Default Address"><Input value={form.recurring_address || ''} onChange={e => set('recurring_address', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Next Cycle Date"><Input type="date" value={form.next_cycle_date || ''} onChange={e => set('next_cycle_date', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                  <div className="flex items-end pb-2"><div className="flex items-center justify-between w-full rounded-lg border border-zinc-200 px-3 py-2"><p className="text-xs text-zinc-600">Show on weekly schedule</p><Switch checked={!!form.show_on_weekly_schedule} onCheckedChange={v => set('show_on_weekly_schedule', v)} /></div></div>
                </div>
                <div className="flex items-center justify-between"><p className="text-xs text-zinc-600">Weekly confirmation required</p><Switch checked={!!form.recurring_weekly_confirmation} onCheckedChange={v => set('recurring_weekly_confirmation', v)} /></div>
                <div className="flex items-center justify-between"><p className="text-xs text-zinc-600">Pause recurring booking</p><Switch checked={!!form.recurring_paused} onCheckedChange={v => set('recurring_paused', v)} /></div>
                <div className="flex items-center justify-between"><p className="text-xs text-zinc-600">Skip next cycle</p><Switch checked={!!form.recurring_skip_cycle} onCheckedChange={v => set('recurring_skip_cycle', v)} /></div>
              </>
            )}
          </div>

          {!isNew && (
            <Link to="/admin/reminders" className="flex items-center justify-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 py-1">
              <Link2 className="w-3.5 h-3.5" /> View in Client Workflow
            </Link>
          )}

          {!isNew && (
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Booking History</p>
              {history.length === 0 ? <p className="text-xs text-zinc-400">No bookings yet.</p> : (
                <div className="space-y-1.5">
                  {history.map(r => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
                      <div>
                        <p className="text-xs font-medium text-zinc-800">{r.day || '—'} {r.assigned_time || ''}</p>
                        <p className="text-[11px] text-zinc-400 truncate">{(r.services || []).join(', ') || r.time_block || ''}</p>
                      </div>
                      <span className="text-[10px] text-zinc-400 shrink-0 ml-2">{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-100 sticky bottom-0 bg-white">
          <Button variant="ghost" className="text-zinc-500 hover:bg-zinc-100" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!form.client_name?.trim() || saving} className="bg-[#6366F1] hover:bg-[#5457e6] text-white">{saving ? 'Saving…' : 'Save Changes'}</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div><Label className="text-xs text-zinc-500 mb-1.5 block">{label}</Label>{children}</div>;
}
function Sel({ value, onChange, options, labels, className }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={cn('w-full text-sm rounded-lg border px-3 py-2 text-zinc-800', className)}>
      {options.map((o, i) => <option key={o} value={o}>{labels ? labels[i] : o}</option>)}
    </select>
  );
}