import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Upload, Download, FileText } from 'lucide-react';

export default function ImportExportMenu({ onImport, onExport, onExportNotes, selectedCount }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50">
        Import / Export <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-40 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl py-1">
          <button onClick={() => { onImport(); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"><Upload className="w-3.5 h-3.5" /> Import clients</button>
          <div className="border-t border-zinc-100 my-1" />
          <button onClick={() => { onExport(); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"><Download className="w-3.5 h-3.5" /> Export clients</button>
          <button onClick={() => { onExportNotes(); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"><FileText className="w-3.5 h-3.5" /> Export notes</button>
        </div>
      )}
    </div>
  );
}