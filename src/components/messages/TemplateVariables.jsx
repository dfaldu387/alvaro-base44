import React from 'react';
import { SAMPLE_VALUES } from '@/lib/messageTemplateMeta';

/** The variables this template supports, with preview sample values and a "blank" test for optional ones. */
export default function TemplateVariables({ meta, blank, setBlank }) {
  if (!meta) return null;
  const toggle = (k) => setBlank((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k]));
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Supported variables</p>
      <ul className="space-y-1">
        {meta.variables.map((v) => (
          <li key={v.key} className="text-[11px] text-zinc-600 break-words">
            <code className="font-bold text-zinc-800">{`{{${v.key}}}`}</code> {v.label}
            {meta.required.includes(v.key) ? ' · required' : ' · optional'} · sample "{SAMPLE_VALUES[v.key]}"
            {v.canBeBlank && (
              <label className="ml-2 inline-flex items-center gap-1 text-amber-700">
                <input type="checkbox" checked={blank.includes(v.key)} onChange={() => toggle(v.key)} /> preview as blank
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}