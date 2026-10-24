import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const AU = /^(\+61|0061|61|0)[\s\-().]*[2-478]([\s\-().]*\d){8}$/;

export default function AllowlistEditor({ numbers, busy, onChange }) {
  const [text, setText] = useState('');
  const valid = AU.test(text.trim());
  const add = () => { if (valid) { onChange([...numbers, text.trim()]); setText(''); } };
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-zinc-700">Allowed numbers ({numbers.length})</p>
      {numbers.length === 0 && <p className="text-xs text-amber-700">The list is empty, so nothing is sent to anyone.</p>}
      <div className="flex flex-wrap gap-1.5">
        {numbers.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-800">
            {n}
            <button disabled={busy} aria-label={`Remove ${n}`} onClick={() => onChange(numbers.filter((x) => x !== n))}><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="0412 345 678" className="h-9 max-w-[220px] bg-white text-zinc-900" />
        <Button size="sm" disabled={!valid || busy} onClick={add}>Add number</Button>
      </div>
    </div>
  );
}