import React, { useEffect, useState, useMemo } from 'react';
import { X, Upload, Trash2, Check, Clock, Scissors, ChevronDown, Plus, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

const COLOUR_SWATCHES = [
  { name: 'purple', hex: '#8B5CF6' },
  { name: 'blue', hex: '#3B82F6' },
  { name: 'green', hex: '#22C55E' },
  { name: 'orange', hex: '#F97316' },
  { name: 'red', hex: '#EF4444' },
  { name: 'pink', hex: '#EC4899' },
  { name: 'yellow', hex: '#EAB308' },
  { name: 'grey', hex: '#6B7280' },
];

const CATEGORIES = [
  { value: 'Haircut', icon: Scissors },
  { value: 'Beard', icon: Scissors },
  { value: 'Kids', icon: Scissors },
  { value: 'Package', icon: Scissors },
  { value: 'Other', icon: Scissors },
];

const PREVIEW_START = 11; // 11:00am fixed start for preview

function formatTime(decimal) {
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  const period = h >= 12 ? 'pm' : 'am';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayH}:${m.toString().padStart(2, '0')}${period}`;
}

export default function ServiceEditorModal({ item, addons, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addonMenuOpen, setAddonMenuOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isNew = !item;

  useEffect(() => {
    setForm({
      name: item?.name || '',
      description: item?.description || '',
      price: item?.price ?? '',
      duration_mins: item?.duration_mins ?? 30,
      buffer_mins: item?.buffer_mins ?? 0,
      color: item?.color || '#8B5CF6',
      category: item?.category || 'Haircut',
      photo_url: item?.photo_url || '',
      is_active: item?.is_active !== false,
      show_on_website: item?.show_on_website !== false,
      group_booking_enabled: item?.group_booking_enabled !== false,
      available_addons: item?.available_addons || [],
      square_item_id: item?.square_item_id || '',
    });
  }, [item]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleAddon = (id) => {
    setForm(f => {
      const arr = f.available_addons || [];
      return { ...f, available_addons: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] };
    });
  };

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
      set('photo_url', file_url);
    } finally { setUploading(false); }
  }

  async function submit() {
    if (!form.name?.trim()) return;
    setSaving(true);
    const payload = {
      ...form,
      price: parseFloat(form.price) || 0,
      duration_mins: parseInt(form.duration_mins) || 0,
      buffer_mins: parseInt(form.buffer_mins) || 0,
    };
    try { await onSave(payload); } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!item) return;
    setSaving(true);
    try { await onDelete(item); } finally { setSaving(false); }
  }

  // Live preview values
  const duration = parseInt(form.duration_mins) || 0;
  const buffer = parseInt(form.buffer_mins) || 0;
  const price = parseFloat(form.price) || 0;
  const totalCalendarTime = duration + buffer;
  const previewEnd = PREVIEW_START + duration / 60;
  const selectedAddons = useMemo(
    () => (addons || []).filter(a => (form.available_addons || []).includes(a.id)),
    [addons, form.available_addons]
  );
  const availableAddons = useMemo(
    () => (addons || []).filter(a => !(form.available_addons || []).includes(a.id) && a.is_active !== false),
    [addons, form.available_addons]
  );

  const selectedCategory = CATEGORIES.find(c => c.value === form.category) || CATEGORIES[0];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-zinc-200 w-full max-w-[680px] max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-7 py-5 border-b border-zinc-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">{isNew ? 'Add Service' : 'Edit Service'}</h2>
            <p className="text-sm text-zinc-500 mt-0.5">Update the details for this service. Changes will apply to future bookings.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto px-7 py-6 space-y-7 flex-1">

          {/* ── Top Row: Photo + Preview ── */}
          <div className="grid grid-cols-2 gap-5">
            {/* Photo */}
            <div>
              <label className="text-sm font-semibold text-zinc-700 mb-2 block">Photo</label>
              <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-50 h-[140px] flex items-center justify-center relative">
                {form.photo_url ? (
                  <img src={form.photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Scissors className="w-8 h-8 text-zinc-300" />
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <label className="flex-1 flex items-center justify-center gap-1.5 border border-zinc-200 rounded-lg py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  {uploading ? 'Uploading…' : 'Change Photo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
                {form.photo_url && (
                  <button
                    onClick={() => set('photo_url', '')}
                    className="flex items-center justify-center gap-1.5 px-3 border border-red-200 bg-red-50 rounded-lg py-2 text-xs font-semibold text-red-500 hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                )}
              </div>
            </div>

            {/* Service Preview */}
            <div>
              <label className="text-sm font-semibold text-zinc-700 mb-2 block">Service Preview</label>
              <div className="rounded-xl bg-[#111111] p-3.5 h-[140px] flex flex-col justify-between">
                <p className="text-[10px] text-zinc-400 font-medium">{formatTime(PREVIEW_START)} – {formatTime(previewEnd)}</p>
                <div>
                  <div className="w-[3px] h-8 rounded-full mb-1.5" style={{ background: form.color }} />
                  <p className="text-sm font-bold text-white truncate">{form.name || 'Service Name'}</p>
                </div>
                <p className="text-[10px] text-zinc-500 font-medium">{duration} min {price > 0 ? `· $${price}` : ''}</p>
              </div>
              <p className="text-[11px] text-zinc-400 mt-2">This is how the service will appear on the calendar.</p>
            </div>
          </div>

          {/* ── Basic Information ── */}
          <Section title="Basic Information">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Service Name</label>
                <Input
                  value={form.name || ''}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Haircut"
                  className="bg-white border-zinc-200 text-zinc-900 h-10"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Service Colour</label>
                <div className="flex gap-2.5 flex-wrap">
                  {COLOUR_SWATCHES.map(sw => {
                    const selected = form.color === sw.hex;
                    return (
                      <button
                        key={sw.hex}
                        type="button"
                        onClick={() => set('color', sw.hex)}
                        className="relative w-9 h-9 rounded-full transition-all"
                        style={{
                          background: sw.hex,
                          boxShadow: selected ? `0 0 0 2px white, 0 0 0 4px ${sw.hex}` : 'none',
                        }}
                      >
                        {selected && (
                          <Check className="w-4 h-4 text-white absolute inset-0 m-auto" strokeWidth={3} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Description <span className="text-zinc-400 font-normal">(shown to clients)</span></label>
                <Textarea
                  value={form.description || ''}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Fade, taper or standard haircut."
                  rows={2}
                  maxLength={200}
                  className="bg-white border-zinc-200 text-zinc-900 resize-none"
                />
                <p className="text-[11px] text-zinc-400 text-right mt-1">{(form.description || '').length}/200</p>
              </div>

              {/* Category dropdown */}
              <div>
                <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Category</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCategoryOpen(o => !o)}
                    className="w-full flex items-center justify-between bg-white border border-zinc-200 rounded-lg px-3 h-10 text-sm text-zinc-900 hover:border-zinc-300 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <selectedCategory.icon className="w-4 h-4 text-zinc-400" />
                      {form.category || 'Haircut'}
                    </span>
                    <ChevronDown className="w-4 h-4 text-zinc-400" />
                  </button>
                  {categoryOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setCategoryOpen(false)} />
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg z-20 overflow-hidden">
                        {CATEGORIES.map(cat => (
                          <button
                            key={cat.value}
                            type="button"
                            onClick={() => { set('category', cat.value); setCategoryOpen(false); }}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-zinc-50 transition-colors ${form.category === cat.value ? 'text-violet-600 font-medium bg-violet-50' : 'text-zinc-700'}`}
                          >
                            <cat.icon className="w-4 h-4 text-zinc-400" />
                            {cat.value}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* ── Pricing & Timing ── */}
          <Section title="Pricing & Timing">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Price ($)</label>
                  <Input
                    type="number"
                    value={form.price}
                    onChange={e => set('price', e.target.value)}
                    placeholder="0"
                    className="bg-white border-zinc-200 text-zinc-900 h-10"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Service Duration (mins)</label>
                  <Input
                    type="number"
                    value={form.duration_mins}
                    onChange={e => set('duration_mins', e.target.value)}
                    placeholder="30"
                    className="bg-white border-zinc-200 text-zinc-900 h-10"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">Time spent cutting the hair.</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Buffer Time (mins)</label>
                  <Input
                    type="number"
                    value={form.buffer_mins}
                    onChange={e => set('buffer_mins', e.target.value)}
                    placeholder="0"
                    className="bg-white border-zinc-200 text-zinc-900 h-10"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">Extra time between bookings.</p>
                </div>
              </div>

              {/* Summary strip */}
              <div className="flex items-center gap-2 bg-violet-50 rounded-lg px-4 py-3">
                <Clock className="w-4 h-4 text-violet-500 shrink-0" />
                <p className="text-sm text-zinc-700">
                  <span className="font-semibold">Total calendar time: {totalCalendarTime} minutes</span>
                  <span className="text-zinc-500 ml-1.5">({duration} min service{buffer > 0 ? ` + ${buffer} min buffer` : ''})</span>
                </p>
              </div>
            </div>
          </Section>

          {/* ── Booking Rules ── */}
          <Section title="Booking Rules">
            <div className="grid grid-cols-3 gap-3">
              <ToggleCard
                label="Active"
                description="Service is available for booking."
                checked={!!form.is_active}
                onChange={v => set('is_active', v)}
              />
              <ToggleCard
                label="Show on public booking"
                description="Visible to clients when booking online."
                checked={!!form.show_on_website}
                onChange={v => set('show_on_website', v)}
              />
              <ToggleCard
                label="Available for group bookings"
                description="This service can be used in group bookings."
                checked={!!form.group_booking_enabled}
                onChange={v => set('group_booking_enabled', v)}
              />
            </div>
          </Section>

          {/* ── Available Add-ons ── */}
          <Section title="Available Add-ons" subtitle="Select which add-ons can be booked with this service.">
            <div className="flex flex-wrap gap-2 items-center">
              {selectedAddons.map(a => (
                <span key={a.id} className="inline-flex items-center gap-1.5 bg-violet-100 text-violet-700 text-xs font-medium px-3 py-1.5 rounded-full">
                  {a.name}
                  <button type="button" onClick={() => toggleAddon(a.id)} className="hover:bg-violet-200 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {availableAddons.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAddonMenuOpen(o => !o)}
                    className="inline-flex items-center gap-1 border border-dashed border-zinc-300 text-zinc-500 text-xs font-medium px-3 py-1.5 rounded-full hover:border-violet-300 hover:text-violet-500 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add Add-on
                  </button>
                  {addonMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAddonMenuOpen(false)} />
                      <div className="absolute top-full left-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg z-20 overflow-hidden min-w-[160px] max-h-[200px] overflow-y-auto">
                        {availableAddons.map(a => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => { toggleAddon(a.id); }}
                            className="w-full text-left px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
                          >
                            {a.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {selectedAddons.length === 0 && availableAddons.length === 0 && (
                <p className="text-xs text-zinc-400">No add-ons available. Create add-ons in the Add-ons tab.</p>
              )}
            </div>
          </Section>

          {/* ── Integrations ── */}
          <Section title="Integrations">
            <div>
              <label className="text-sm font-medium text-zinc-700 mb-1.5 block">Square item ID <span className="text-zinc-400 font-normal">(optional)</span></label>
              <Input
                value={form.square_item_id || ''}
                onChange={e => set('square_item_id', e.target.value)}
                placeholder="SQ1234567890"
                className="bg-white border-zinc-200 text-zinc-900 h-10"
              />
              <p className="text-[11px] text-zinc-400 mt-1">Link to your Square catalog item for synced pricing.</p>
            </div>
          </Section>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-7 py-4 border-t border-zinc-100 shrink-0 bg-white">
          {/* Delete (left) */}
          <div>
            {!isNew && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 bg-red-50 text-red-500 text-sm font-semibold px-3.5 py-2 rounded-lg hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Service
              </button>
            )}
          </div>

          {/* Cancel + Save (right) */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="text-zinc-500 hover:bg-zinc-100" onClick={onClose}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={!form.name?.trim() || saving}
              className="bg-[#6366F1] hover:bg-[#5457e6] text-white"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-zinc-200 p-6 w-full max-w-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900">Delete this service?</h3>
                <p className="text-sm text-zinc-500 mt-1">This action cannot be undone. Existing bookings will keep their recorded service details.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDeleteConfirm(false)} className="text-sm font-semibold text-zinc-500 hover:text-zinc-700 px-4 py-2.5 rounded-lg hover:bg-zinc-100 transition-colors">Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="text-sm font-bold text-white bg-red-500 hover:bg-red-600 px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50">
                {saving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ToggleCard({ label, description, checked, onChange }) {
  return (
    <div className={`rounded-xl border p-3.5 transition-colors ${checked ? 'border-violet-200 bg-violet-50/50' : 'border-zinc-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold text-zinc-800">{label}</span>
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
      <p className="text-[11px] text-zinc-400 leading-snug">{description}</p>
    </div>
  );
}