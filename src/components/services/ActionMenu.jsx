import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export default function ActionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
      >
        <MoreVertical className="w-4.5 h-4.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-48 bg-white border border-zinc-200 rounded-lg shadow-lg py-1">
          {items.map((item, i) =>
            item.divider ? (
              <div key={i} className="my-1 border-t border-zinc-100" />
            ) : (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setOpen(false); item.onClick(); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-50 transition-colors ${item.danger ? 'text-red-600' : 'text-zinc-700'}`}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}