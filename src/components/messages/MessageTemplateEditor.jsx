import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { EXPECTED_TEMPLATE_KEYS } from '@/lib/messageTemplateMeta';
import TemplateCard from '@/components/messages/TemplateCard';

/** The one place message wording is edited. Reads and writes the MessageTemplate records. */
export default function MessageTemplateEditor() {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const rows = (await base44.entities.MessageTemplate.list('created_date', 100)) || [];
      const byKey = new Map();
      for (const r of rows) if (!byKey.has(r.template_key)) byKey.set(r.template_key, r);
      const idx = (k) => { const i = EXPECTED_TEMPLATE_KEYS.indexOf(k); return i < 0 ? 99 : i; };
      setTemplates([...byKey.values()].sort((a, b) => idx(a.template_key) - idx(b.template_key)));
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setSeeding(true);
    try { await base44.functions.invoke('seedMessageTemplates', {}); await load(); }
    catch { setError(true); }
    finally { setSeeding(false); }
  };

  const replace = (next) => setTemplates((prev) => prev.map((t) => (t.id === next.id ? next : t)));

  if (error) return <button onClick={load} className="text-sm font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-4 py-2">Templates could not be loaded. Try again</button>;
  if (!templates) return <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />;

  const missing = EXPECTED_TEMPLATE_KEYS.filter((k) => !templates.some((t) => t.template_key === k));

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Editing wording here changes what future messages say. Saving never queues or sends a message. Previews use James · Friday 11 Jul · 2:00pm–4:00pm · 2:30pm.</p>
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-xs text-amber-800 min-w-0 break-words">Missing: {missing.join(', ')}. Messages that use them will not be sent. New campaign wording is added switched off.</p>
          <button onClick={seed} disabled={seeding} className="text-xs font-bold text-amber-800 border border-amber-300 rounded-lg px-3 py-1.5 shrink-0 disabled:opacity-60">
            {seeding ? 'Adding…' : 'Add missing templates'}
          </button>
        </div>
      )}
      {templates.length === 0 && <p className="text-sm text-zinc-500">No templates exist yet.</p>}
      {templates.map((t) => <TemplateCard key={t.id} template={t} onChanged={replace} />)}
    </div>
  );
}