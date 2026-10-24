import React from 'react';
import { X } from 'lucide-react';
import { CLIENT_STATUSES, AVAILABILITY_TYPES, frequencyDisplay } from '@/lib/clientStatus';

const FREQS = ['Weekly', 'Fortnightly', 'Every 3 weeks', 'Monthly'];
const AVAILS = ['Fixed Time', 'Fixed Window', 'Flexible', 'Not Configured'];

export default function FilterPanel({ open, filters, onChange, onClose, onClear, suburbs, postcodes, services }) {
  if (!open) return null;
  const set = (k, v) => onChange({ ...filters, [k]: v });
  const toggleArr = (k, v) => set(k, (filters[k] || []).includes(v) ? filters[k].filter(x => x !== v) : [...(filters[k] || []), v]);
  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full sm:max-w-[380px] bg-white border-l border-zinc-200 h-full overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-zinc-900">Filter clients by</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-5 flex-1">
          <Group title="Client status">
            {CLIENT_STATUSES.map(s => <CheckRow key={s} label={s} checked={(filters.status || []).includes(s)} onChange={() => toggleArr('status', s)} />)}
          </Group>
          <Group title="Frequency">
            {FREQS.map(s => <CheckRow key={s} label={s} checked={(filters.frequency || []).includes(s)} onChange={() => toggleArr('frequency', s)} />)}
          </Group>
          <Group title="Availability type">
            {AVAILS.map(s => <CheckRow key={s} label={s} checked={(filters.availability || []).includes(s)} onChange={() => toggleArr('availability', s)} />)}
          </Group>
          <Group title="Recurring booking">
            <RadioRow label="Any" checked={filters.recurring !== 'enabled' && filters.recurring !== 'disabled'} onChange={() => set('recurring', 'any')} />
            <RadioRow label="Recurring enabled" checked={filters.recurring === 'enabled'} onChange={() => set('recurring', 'enabled')} />
            <RadioRow label="Recurring disabled" checked={filters.recurring === 'disabled'} onChange={() => set('recurring', 'disabled')} />
            <CheckRow label="Recurring booking paused" checked={!!filters.recurring_paused} onChange={() => set('recurring_paused', !filters.recurring_paused)} />
            <CheckRow label="Weekly confirmation required" checked={!!filters.weekly_confirmation} onChange={() => set('weekly_confirmation', !filters.weekly_confirmation)} />
          </Group>
          <Group title="Visit details">
            <CheckRow label="No completed visits" checked={!!filters.no_visits} onChange={() => set('no_visits', !filters.no_visits)} />
            <CheckRow label="Last visit more than 35 days ago" checked={!!filters.last_visit_35} onChange={() => set('last_visit_35', !filters.last_visit_35)} />
            <div className="py-1">
              <label className="text-xs text-zinc-500">Minimum visit count</label>
              <input type="number" min="0" value={filters.visit_min || ''} onChange={e => set('visit_min', e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-zinc-500">Last visit from</label>
                <input type="date" value={filters.last_visit_from || ''} onChange={e => set('last_visit_from', e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Last visit to</label>
                <input type="date" value={filters.last_visit_to || ''} onChange={e => set('last_visit_to', e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-zinc-500">First visit from</label>
                <input type="date" value={filters.first_visit_from || ''} onChange={e => set('first_visit_from', e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">First visit to</label>
                <input type="date" value={filters.first_visit_to || ''} onChange={e => set('first_visit_to', e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" />
              </div>
            </div>
          </Group>
          <Group title="Client information">
            <CheckRow label="Has phone number" checked={!!filters.has_phone} onChange={() => set('has_phone', !filters.has_phone)} />
            <CheckRow label="Has email" checked={!!filters.has_email} onChange={() => set('has_email', !filters.has_email)} />
            <CheckRow label="Has address" checked={!!filters.has_address} onChange={() => set('has_address', !filters.has_address)} />
            <CheckRow label="Has notes" checked={!!filters.has_notes} onChange={() => set('has_notes', !filters.has_notes)} />
            <CheckRow label="Has manual tags" checked={!!filters.has_manual_tags} onChange={() => set('has_manual_tags', !filters.has_manual_tags)} />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="text-xs text-zinc-500">Created from</label>
                <input type="date" value={filters.created_from || ''} onChange={e => set('created_from', e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Created to</label>
                <input type="date" value={filters.created_to || ''} onChange={e => set('created_to', e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" />
              </div>
            </div>
          </Group>
          <Group title="Financial">
            <div className="grid grid-cols-3 gap-2">
              <NumField label="Avg ≥" value={filters.avg_min} onChange={v => set('avg_min', v)} />
              <NumField label="Lifetime ≥" value={filters.lt_min} onChange={v => set('lt_min', v)} />
              <NumField label="Txns ≥" value={filters.tx_min} onChange={v => set('tx_min', v)} />
            </div>
          </Group>
          {suburbs.length > 0 && (
            <Group title="Location — Suburb">
              <div className="max-h-32 overflow-y-auto">{suburbs.map(s => <CheckRow key={s} label={s} checked={(filters.suburb || []).includes(s)} onChange={() => toggleArr('suburb', s)} />)}</div>
            </Group>
          )}
          {postcodes.length > 0 && (
            <Group title="Location — Postcode">
              <div className="max-h-32 overflow-y-auto">{postcodes.map(s => <CheckRow key={s} label={s} checked={(filters.postcode || []).includes(s)} onChange={() => toggleArr('postcode', s)} />)}</div>
            </Group>
          )}
          {services.length > 0 && (
            <Group title="Service">
              <div className="max-h-32 overflow-y-auto">{services.map(s => <CheckRow key={s} label={s} checked={(filters.service || []).includes(s)} onChange={() => toggleArr('service', s)} />)}</div>
            </Group>
          )}
        </div>
        <div className="flex justify-between px-5 py-4 border-t border-zinc-100 sticky bottom-0 bg-white">
          <button onClick={onClear} className="text-sm text-indigo-600 hover:text-indigo-700">Clear All</button>
          <button onClick={onClose} className="h-9 px-4 rounded-lg bg-[#6366F1] hover:bg-[#5457e6] text-white text-sm">Apply Filters</button>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (<div><p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">{title}</p><div className="space-y-0.5">{children}</div></div>);
}
function CheckRow({ label, checked, onChange }) {
  return (<label className="flex items-center gap-2.5 py-1 cursor-pointer"><input type="checkbox" checked={!!checked} onChange={onChange} className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500" /><span className="text-sm text-zinc-700">{label}</span></label>);
}
function RadioRow({ label, checked, onChange }) {
  return (<label className="flex items-center gap-2.5 py-1 cursor-pointer"><input type="radio" checked={!!checked} onChange={onChange} className="w-4 h-4 border-zinc-300 text-indigo-600 focus:ring-indigo-500" /><span className="text-sm text-zinc-700">{label}</span></label>);
}
function NumField({ label, value, onChange }) {
  return (<div><label className="text-xs text-zinc-500">{label}</label><input type="number" min="0" value={value || ''} onChange={e => onChange(e.target.value)} className="mt-1 w-full h-8 rounded-md border border-zinc-200 px-2 text-sm" /></div>);
}