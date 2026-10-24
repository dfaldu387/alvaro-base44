/**
 * StaffFilter — compact dropdown for selecting which barber's calendar to view.
 * Options: All barbers, Only me, individual team members.
 */
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function StaffFilter({ members, selectedId, onChange, currentUserMemberId }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = members.find(m => m.id === selectedId);
  const label = !selectedId ? 'All barbers' : selectedId === currentUserMemberId ? 'Only me' : selected?.name || 'All barbers';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-1.5 bg-white border border-zinc-200 text-zinc-700 text-xs font-semibold px-3 py-2 max-sm:min-h-11 rounded-lg hover:bg-zinc-50 transition-all"
      >
        <Users className="w-3.5 h-3.5 text-zinc-500" />
        {label}
        <ChevronDown className={cn('w-3 h-3 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-zinc-200 rounded-lg shadow-lg min-w-[180px] py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn('w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors hover:bg-zinc-50',
              !selectedId ? 'font-semibold text-indigo-600 bg-indigo-50' : 'text-zinc-600')}
          >
            All barbers
            {!selectedId && <Check className="w-3.5 h-3.5" />}
          </button>
          {currentUserMemberId && (
            <button
              onClick={() => { onChange(currentUserMemberId); setOpen(false); }}
              className={cn('w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors hover:bg-zinc-50',
                selectedId === currentUserMemberId ? 'font-semibold text-indigo-600 bg-indigo-50' : 'text-zinc-600')}
            >
              Only me
              {selectedId === currentUserMemberId && <Check className="w-3.5 h-3.5" />}
            </button>
          )}
          <div className="border-t border-zinc-200 my-1" />
          {members.filter(m => m.status === 'Active').map(m => (
            <button
              key={m.id}
              onClick={() => { onChange(m.id); setOpen(false); }}
              className={cn('w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors hover:bg-zinc-50',
                selectedId === m.id ? 'font-semibold text-indigo-600 bg-indigo-50' : 'text-zinc-600')}
            >
              <span className="flex items-center gap-2 truncate">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.avatar_color || '#5E42F3' }} />
                {m.name}
              </span>
              {selectedId === m.id && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}