import React, { useState } from 'react';
import { X } from 'lucide-react';

// Tag-style input for suburbs / postcodes. Enter or comma adds a tag; clicking
// the x removes it. Tags are stored as a flat string array.
export default function TagInput({ values = [], onChange, placeholder }) {
  const [draft, setDraft] = useState('');

  const addTag = (raw) => {
    const v = (raw || '').trim();
    if (!v) return;
    if (values.some(x => x.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };

  const removeTag = (idx) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === 'Backspace' && !draft && values.length) {
      removeTag(values.length - 1);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-2 focus-within:border-violet-400">
      {values.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-violet-50 border border-violet-200 px-2 py-0.5 text-xs font-medium text-violet-700">
          {v}
          <button type="button" onClick={() => removeTag(i)} className="text-violet-400 hover:text-violet-700">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => addTag(draft)}
        placeholder={values.length ? '' : placeholder}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}