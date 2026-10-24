/**
 * BookingRules — Online Booking Settings for Cut Deluxe.
 * Practical settings adapted for a mobile barber, not a generic SaaS template.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_SETTINGS, fromRecord, validateSettings, toPayload, recordMatches } from '@/lib/bookingRulesSettings';
import GroupDiscountSection from '@/components/admin/GroupDiscountSection';
import AppointmentProtectionSection from '@/components/admin/AppointmentProtectionSection';
import BookingWindowSection from '@/components/admin/BookingWindowSection';
import { Accordion, Toggle, NumberField, InfoField, NotInEffect, NotInEffectNote } from '@/components/admin/rules/RuleFields';
import AdminPage from '@/components/admin/ui/AdminPage';
import AdminCard from '@/components/admin/ui/AdminCard';

const TITLE = 'Booking Rules';
const SUBTITLE = 'Online booking settings for Cut Deluxe';

export default function BookingRules() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [openSections, setOpenSections] = useState({ general: true, window: true, availWindow: false, area: false, cancel: false, templates: false, group: false, protection: false });
  const [saved, setSaved] = useState(false);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);

  // Load the persisted record. If none exists yet, create it with the default
  // booking window, so the Booking Window section and this page share one record.
  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      // Read only. With no row yet the defaults show, and the first save creates the one row on the server.
      const record = ((await base44.entities.BookingRules.list('-created_date', 1)) || [])[0];
      setSettings(fromRecord(record));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (k) => setOpenSections(p => ({ ...p, [k]: !p[k] }));
  const set = (k, v) => {
    setSettings(p => ({ ...p, [k]: v }));
    setErrors(p => (p[k] ? { ...p, [k]: undefined } : p));
    setSaved(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (saving || loadState !== 'ready') return;
    const found = validateSettings(settings);
    setErrors(found);
    setSaved(false);
    if (Object.keys(found).length > 0) {
      setSaveError('Some settings are not valid. Fix the highlighted fields and save again.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = toPayload(settings);
      await saveSettings('BookingRules', 'rules', payload);
      // Success is shown only once the stored record reads back with these values.
      const stored = ((await base44.entities.BookingRules.list('-created_date', 1)) || [])[0];
      if (!recordMatches(stored, payload)) throw new Error('mismatch');
      setSettings(fromRecord(stored));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError('Settings could not be saved. Your changes are not stored — please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loadState !== 'ready') {
    return (
      <AdminPage title={TITLE} subtitle={SUBTITLE}>
        <div className="py-16 flex flex-col items-center gap-3 text-center" aria-busy={loadState === 'loading'}>
          {loadState === 'loading' ? (
            <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
          ) : (
            <>
              <p className="text-sm text-zinc-900">Booking Rules could not be loaded.</p>
              <Button variant="outline" className="min-h-[44px]" onClick={load}>Try again</Button>
            </>
          )}
        </div>
      </AdminPage>
    );
  }

  return (
    <AdminPage title={TITLE} subtitle={SUBTITLE}>
      <div className="space-y-3 pb-20 max-w-3xl">

        <Accordion title="General" open={openSections.general} onToggle={() => toggle('general')}>
          <Toggle label="Accept booking requests automatically" sub="OFF = admin reviews all requests first" value={settings.autoAccept} onChange={v => set('autoAccept', v)} />
          <NotInEffectNote>The four settings marked below are saved but nothing uses them yet. Customers can still pick as many services as they like, each service uses the buffer set on its own Services card, and start times are not snapped to the interval.</NotInEffectNote>
          <Toggle inactive label="Allow multiple services per booking" value={settings.allowMultipleServices} onChange={v => set('allowMultipleServices', v)} />
          <NumberField inactive label="Max services per booking" value={settings.maxServicesPerBooking} onChange={v => set('maxServicesPerBooking', v)} min={1} max={10} error={errors.maxServicesPerBooking} />
          <NumberField inactive label="Default buffer time (mins)" value={settings.defaultBuffer} onChange={v => set('defaultBuffer', v)} min={0} max={120} error={errors.defaultBuffer} />
          <NumberField inactive label="Appointment interval (mins)" value={settings.appointmentInterval} onChange={v => set('appointmentInterval', v)} min={5} max={60} error={errors.appointmentInterval} />
          <InfoField label="Business time zone" value="Australia/Sydney (locked)" />
        </Accordion>

        <Accordion title="Booking Window" open={openSections.window} onToggle={() => toggle('window')}>
          <BookingWindowSection />
        </Accordion>

        {/* Availability Window — the window a customer picks their time inside */}
        <Accordion title="Availability Window Rules" open={openSections.availWindow} onToggle={() => toggle('availWindow')}>
          <NotInEffectNote>None of the settings in this group are used yet. Customers are not cut off at the time below, window lengths are not checked against these limits, and a service must always fit inside the customer&apos;s window whatever the toggles say.</NotInEffectNote>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Booking cut-off time (day before)<NotInEffect /></label>
            <select value={settings.cutoffHour} onChange={e => set('cutoffHour', Number(e.target.value))} className="w-full h-10 bg-white border border-zinc-200 rounded-lg px-3 text-sm text-zinc-900 outline-none focus:ring-1 focus:ring-ring">
              {[17,18,19,20,21,22].map(h => {
                const label = h >= 12 ? `${h === 12 ? 12 : h - 12}:00pm` : `${h}:00am`;
                return <option key={h} value={h}>{label}</option>;
              })}
            </select>
          </div>
          <NumberField inactive label="Minimum availability window (hours)" value={settings.minWindowHours} onChange={v => set('minWindowHours', v)} min={0.5} max={6} step={0.5} error={errors.minWindowHours} />
          <NumberField inactive label="Maximum availability window (hours)" value={settings.maxWindowHours} onChange={v => set('maxWindowHours', v)} min={1} max={8} step={0.5} error={errors.maxWindowHours} />
          <Toggle inactive label="Service must fit inside selected window" value={settings.serviceMustFit} onChange={v => set('serviceMustFit', v)} />
          <Toggle inactive label="Buffer can extend outside selected window" value={settings.bufferCanExtend} onChange={v => set('bufferCanExtend', v)} />
        </Accordion>

        <Accordion title="Service Area Rules" open={openSections.area} onToggle={() => toggle('area')}>
          <NotInEffectNote>Neither setting here is used yet. Where you work is decided by the zones on the Service Coverage page, and out-of-area requests are not held for review by the toggle below.</NotInEffectNote>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Core service areas<NotInEffect /></label>
            <Textarea value={settings.coreAreas} onChange={e => set('coreAreas', e.target.value)} rows={2} className="bg-white resize-none" />
            {errors.coreAreas && <p className="text-xs text-red-600 mt-1">{errors.coreAreas}</p>}
          </div>
          <Toggle inactive label="Out-of-area requests after 3pm require review" value={settings.outOfAreaAfter3pm} onChange={v => set('outOfAreaAfter3pm', v)} />
        </Accordion>

        <Accordion title="Cancellation & Reschedule Rules" open={openSections.cancel} onToggle={() => toggle('cancel')}>
          <NotInEffectNote>Nothing here is used yet. The policy text is not shown to customers, and customers cannot ask for a change online, so these toggles change nothing.</NotInEffectNote>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Cancellation policy text<NotInEffect /></label>
            <Textarea value={settings.cancellationPolicy} onChange={e => set('cancellationPolicy', e.target.value)} rows={4} className="bg-white resize-none" />
            {errors.cancellationPolicy && <p className="text-xs text-red-600 mt-1">{errors.cancellationPolicy}</p>}
          </div>
          <Toggle inactive label="Allow clients to request changes" value={settings.allowClientReschedule} onChange={v => set('allowClientReschedule', v)} />
          <Toggle inactive label="Admin must approve reschedule requests" value={settings.clientNeedsApproval} onChange={v => set('clientNeedsApproval', v)} />
          <div className="bg-zinc-50 rounded-xl px-3 py-2.5">
            <p className="text-xs text-zinc-500">No-show fee processing: <span className="text-zinc-900 font-medium">Manual only (V1)</span></p>
            <p className="text-xs text-zinc-500 mt-1">Automations: <span className="text-zinc-900 font-medium">Coming soon</span></p>
          </div>
        </Accordion>

        <AdminCard>
          <p className="text-sm font-semibold text-zinc-900">Message Templates</p>
          <p className="text-xs text-zinc-500 mt-1">Message wording is now edited in one place.</p>
          <Link to="/admin/settings/messaging#diagnostics" className="inline-flex items-center min-h-[44px] text-xs font-semibold text-indigo-600 hover:text-indigo-700">Edit templates in Messaging &amp; Automation</Link>
        </AdminCard>

        <Accordion title="Group Booking Discounts" open={openSections.group} onToggle={() => toggle('group')}>
          <GroupDiscountSection />
        </Accordion>

        <Accordion title="Appointment Protection" open={openSections.protection} onToggle={() => toggle('protection')}>
          <AppointmentProtectionSection />
        </Accordion>

      </div>

      {/* Save */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-20 bg-white border-t border-zinc-200 px-4 py-3">
        {saveError && <p role="alert" className="text-xs text-red-600 mb-2 text-center">{saveError}</p>}
        <Button onClick={handleSave} disabled={saving} className={`w-full min-h-[44px] font-bold ${saved ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : ''}`}>
          {saving ? 'Saving…' : saved ? '✓ Settings Saved' : 'Save Settings'}
        </Button>
      </div>
    </AdminPage>
  );
}