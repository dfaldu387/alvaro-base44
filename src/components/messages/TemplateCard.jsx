import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import useTemplatePreview from '@/hooks/useTemplatePreview';
import TemplatePreview from '@/components/messages/TemplatePreview';
import TemplateVariables from '@/components/messages/TemplateVariables';
import { SAMPLE_VALUES, TEMPLATE_META, validateBody } from '@/lib/messageTemplateMeta';

export default function TemplateCard({ template, onChanged }) {
  const { toast } = useToast();
  const meta = TEMPLATE_META[template.template_key];
  const [body, setBody] = useState(template.body || '');
  const [blank, setBlank] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const payload = { ...SAMPLE_VALUES, ...Object.fromEntries(blank.map((k) => [k, ''])) };
  const preview = useTemplatePreview(body, payload);
  const check = validateBody(template.template_key, body);
  const dirty = body !== (template.body || '');
  const active = template.is_active !== false;
  const blocked = check.unknown.length > 0 || check.missingRequired.length > 0 || check.malformed || body.trim() === '';

  // Save, then read the record back: success is only reported if the stored body matches.
  const persist = async (data, check_) => {
    setBusy(true); setError('');
    try {
      await base44.entities.MessageTemplate.update(template.id, data);
      const stored = await base44.entities.MessageTemplate.get(template.id);
      if (!check_(stored)) throw new Error('mismatch');
      onChanged({ ...template, ...stored });
      toast({ title: 'Saved. Future messages will use this.' });
    } catch {
      setError('Could not save the template. Nothing was changed.');
    } finally { setBusy(false); }
  };

  const save = () => persist({ body }, (s) => s.body === body);
  const toggleActive = () => persist({ is_active: !active }, (s) => (s.is_active !== false) === !active);

  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900 break-words">{template.name || template.template_key}</p>
          <p className="text-[11px] text-zinc-500 break-all">Key: {template.template_key} · {active ? 'Active' : 'Switched off'}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">Sent when: {meta?.trigger || template.description || 'unknown'}</p>
        </div>
        <button onClick={toggleActive} disabled={busy} aria-pressed={active} aria-label={`${active ? 'Switch off' : 'Switch on'} ${template.name || template.template_key}`}
          className={`w-11 h-6 rounded-full shrink-0 relative disabled:opacity-60 ${active ? 'bg-indigo-600' : 'bg-zinc-300'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
      {!active && <p className="text-[11px] text-amber-700">Switched off: messages using this template are not sent.</p>}
      <TemplateVariables meta={meta} blank={blank} setBlank={setBlank} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} aria-label="Message wording"
        className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none resize-none" />
      {!check.known && <p className="text-xs text-amber-700">No variable definition exists for this template, so placeholders cannot be checked.</p>}
      {check.unknown.length > 0 && <p role="alert" className="text-xs text-red-600">Not supported by this template: {check.unknown.map((u) => `{{${u}}}`).join(', ')}. The message may render incorrectly or not be sent.</p>}
      {check.missingRequired.length > 0 && <p role="alert" className="text-xs text-red-600">Required but missing from the wording: {check.missingRequired.map((u) => `{{${u}}}`).join(', ')}.</p>}
      {check.malformed && <p role="alert" className="text-xs text-red-600">Stray braces found. Placeholders must look like {'{{name}}'}.</p>}
      <TemplatePreview preview={preview} />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        {dirty && <button onClick={() => setBody(template.body || '')} className="text-xs font-semibold text-zinc-500 px-3 py-1.5">Discard</button>}
        <button onClick={save} disabled={!dirty || busy || blocked}
          className="text-xs font-bold bg-indigo-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">
          {busy ? 'Saving…' : 'Save wording'}
        </button>
      </div>
    </div>
  );
}