import React, { useEffect, useState } from 'react';
import { X, Upload, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

const TYPE_LABEL = { service: 'Service', addon: 'Add-on', product: 'Product' };

export default function ItemEditor({ type, item, services, addons, products, onClose, onSave }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isNew = !item;

  useEffect(() => {
    if (type === 'service') {
      setForm(item ? {
        name: item.name || '', description: item.description || '', price: item.price || '',
        duration_mins: item.duration_mins || '', photo_url: item.photo_url || '',
        is_active: item.is_active !== false, sort_order: item.sort_order || 0,
        available_addons: item.available_addons || [], suggested_products: item.suggested_products || [],
        square_item_id: item.square_item_id || '',
      } : { name: '', description: '', price: '', duration_mins: '', photo_url: '', is_active: true, sort_order: 0, available_addons: [], suggested_products: [], square_item_id: '' });
    } else if (type === 'addon') {
      setForm(item ? {
        name: item.name || '', description: item.description || '', photo_url: item.photo_url || '',
        price_adjustment: item.price_adjustment || 0, duration_adjustment: item.duration_adjustment || 0,
        variable_price: !!item.variable_price, min_price: item.min_price || '', max_duration: item.max_duration || '',
        compatible_services: item.compatible_services || [], is_active: item.is_active !== false,
        sort_order: item.sort_order || 0, square_item_id: item.square_item_id || '',
      } : { name: '', description: '', photo_url: '', price_adjustment: 0, duration_adjustment: 0, variable_price: false, min_price: '', max_duration: '', compatible_services: [], is_active: true, sort_order: 0, square_item_id: '' });
    } else {
      setForm(item ? {
        name: item.name || '', description: item.description || '', photo_url: item.photo_url || '',
        selling_price: item.selling_price || '', cost_price: item.cost_price || '',
        stock_quantity: item.stock_quantity || 0, low_stock_threshold: item.low_stock_threshold || 5,
        is_active: item.is_active !== false, suggested_services: item.suggested_services || [],
        suggested_client_tags: (item.suggested_client_tags || []).join(', '),
        square_item_id: item.square_item_id || '', square_variation_id: item.square_variation_id || '',
      } : { name: '', description: '', photo_url: '', selling_price: '', cost_price: '', stock_quantity: 0, low_stock_threshold: 5, is_active: true, suggested_services: [], suggested_client_tags: '', square_item_id: '', square_variation_id: '' });
    }
  }, [type, item]);

  if (!form || !form.hasOwnProperty) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleArr = (k, id) => setForm(f => {
    const arr = f[k] || [];
    return { ...f, [k]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] };
  });

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { const { file_url } = await base44.integrations.Core.UploadFile({ file }); set('photo_url', file_url); }
    finally { setUploading(false); }
  }

  async function submit() {
    if (!form.name?.trim()) return;
    setSaving(true);
    const payload = { ...form };
    if (type === 'service') {
      payload.price = parseFloat(payload.price) || 0;
      payload.duration_mins = parseInt(payload.duration_mins) || 0;
    } else if (type === 'addon') {
      payload.price_adjustment = parseFloat(payload.price_adjustment) || 0;
      payload.duration_adjustment = parseInt(payload.duration_adjustment) || 0;
      payload.min_price = payload.min_price ? parseFloat(payload.min_price) : null;
      payload.max_duration = payload.max_duration ? parseInt(payload.max_duration) : null;
    } else {
      payload.selling_price = parseFloat(payload.selling_price) || 0;
      payload.cost_price = payload.cost_price ? parseFloat(payload.cost_price) : null;
      payload.stock_quantity = parseInt(payload.stock_quantity) || 0;
      payload.low_stock_threshold = parseInt(payload.low_stock_threshold) || 5;
      payload.suggested_client_tags = (payload.suggested_client_tags || '').split(',').map(t => t.trim()).filter(Boolean);
    }
    try { await onSave(payload); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-[440px] bg-white border-l border-zinc-200 h-full overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-zinc-900">{isNew ? 'Add' : 'Edit'} {TYPE_LABEL[type]}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3.5 flex-1">
          {/* Photo */}
          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Photo</Label>
            {form.photo_url ? (
              <div className="relative rounded-lg overflow-hidden bg-zinc-100 h-32">
                <img src={form.photo_url} alt="" className="w-full h-full object-cover" />
                <button onClick={() => set('photo_url', '')} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <label className="cursor-pointer flex flex-col items-center justify-center gap-1.5 w-full rounded-lg border-2 border-dashed border-zinc-200 py-6 hover:border-violet-300 hover:bg-violet-50/30 transition-all">
                <Upload className="w-5 h-5 text-zinc-400" />
                <span className="text-xs text-zinc-500">{uploading ? 'Uploading…' : 'Upload image'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            )}
          </div>

          <Field label="Name"><Input value={form.name || ''} onChange={e => set('name', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
          <Field label="Description"><Textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows={2} className="bg-white border-zinc-200 text-zinc-900" /></Field>

          {type === 'service' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price ($)"><Input type="number" value={form.price} onChange={e => set('price', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                <Field label="Duration (mins)"><Input type="number" value={form.duration_mins} onChange={e => set('duration_mins', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              </div>
              <Field label="Square item ID (optional)"><Input value={form.square_item_id || ''} onChange={e => set('square_item_id', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              <MultiSelect label="Available add-ons" options={addons} selected={form.available_addons || []} onToggle={id => toggleArr('available_addons', id)} />
              <MultiSelect label="Suggested products" options={products} selected={form.suggested_products || []} onToggle={id => toggleArr('suggested_products', id)} />
            </>
          )}

          {type === 'addon' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price add ($)"><Input type="number" value={form.price_adjustment} onChange={e => set('price_adjustment', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                <Field label="Duration add (mins)"><Input type="number" value={form.duration_adjustment} onChange={e => set('duration_adjustment', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5">
                <span className="text-sm text-zinc-700">Variable price</span>
                <Switch checked={!!form.variable_price} onCheckedChange={v => set('variable_price', v)} />
              </div>
              {form.variable_price && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Min price ($)"><Input type="number" value={form.min_price} onChange={e => set('min_price', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                  <Field label="Max duration (mins)"><Input type="number" value={form.max_duration} onChange={e => set('max_duration', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                </div>
              )}
              <Field label="Square item ID (optional)"><Input value={form.square_item_id || ''} onChange={e => set('square_item_id', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              <MultiSelect label="Compatible services" options={services} selected={form.compatible_services || []} onToggle={id => toggleArr('compatible_services', id)} />
            </>
          )}

          {type === 'product' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Selling price ($)"><Input type="number" value={form.selling_price} onChange={e => set('selling_price', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                <Field label="Cost price ($)"><Input type="number" value={form.cost_price} onChange={e => set('cost_price', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stock quantity"><Input type="number" value={form.stock_quantity} onChange={e => set('stock_quantity', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                <Field label="Low-stock threshold"><Input type="number" value={form.low_stock_threshold} onChange={e => set('low_stock_threshold', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Square item ID"><Input value={form.square_item_id || ''} onChange={e => set('square_item_id', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
                <Field label="Square variation ID"><Input value={form.square_variation_id || ''} onChange={e => set('square_variation_id', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              </div>
              <Field label="Suggested client tags (comma separated)"><Input value={form.suggested_client_tags || ''} onChange={e => set('suggested_client_tags', e.target.value)} className="bg-white border-zinc-200 text-zinc-900" /></Field>
              <MultiSelect label="Suggested after services" options={services} selected={form.suggested_services || []} onToggle={id => toggleArr('suggested_services', id)} />
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5">
            <span className="text-sm text-zinc-700">Active</span>
            <Switch checked={!!form.is_active} onCheckedChange={v => set('is_active', v)} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-100 sticky bottom-0 bg-white">
          <Button variant="ghost" className="text-zinc-500 hover:bg-zinc-100" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!form.name?.trim() || saving} className="bg-[#6366F1] hover:bg-[#5457e6] text-white">
            {saving ? 'Saving…' : <><Check className="w-4 h-4" /> Save</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div><Label className="text-xs text-zinc-500 mb-1.5 block">{label}</Label>{children}</div>;
}

function MultiSelect({ label, options, selected, onToggle }) {
  if (!options || options.length === 0) return null;
  return (
    <div>
      <Label className="text-xs text-zinc-500 mb-1.5 block">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const active = selected.includes(o.id);
          return (
            <button key={o.id} type="button" onClick={() => onToggle(o.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${active ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300'}`}>
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}