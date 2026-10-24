import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Users, Folder, Trash2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SMART_GROUPS } from '@/lib/clientStatus';

export default function GroupSelector({ selected, onSelect, customGroups, onCreate, onRename, onDelete, counts }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  const label = selected === 'all' ? 'All clients'
    : (SMART_GROUPS.find(g => g.key === selected)?.label)
    || customGroups.find(g => g.id === selected)?.name
    || 'All clients';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50">
        <Users className="w-4 h-4" /> Group: <span className="font-medium">{label}</span> <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 z-40 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl py-1 max-h-[70vh] overflow-y-auto">
          <button onClick={() => { onSelect('all'); setOpen(false); }} className={cn('w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-50', selected === 'all' && 'text-indigo-600 font-medium')}>All clients</button>
          <p className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mt-1">Smart groups</p>
          {SMART_GROUPS.map(g => (
            <button key={g.key} onClick={() => { onSelect(g.key); setOpen(false); }} className={cn('w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-zinc-50', selected === g.key && 'text-indigo-600 font-medium')}>
              <span>{g.label}</span><span className="text-[11px] text-zinc-400">{counts[g.key] || 0}</span>
            </button>
          ))}
          <p className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mt-1">Custom groups</p>
          {customGroups.length === 0 && <p className="px-3 py-1.5 text-xs text-zinc-400">No custom groups yet.</p>}
          {customGroups.map(g => (
            <div key={g.id} className="flex items-center">
              <button onClick={() => { onSelect(g.id); setOpen(false); }} className={cn('flex-1 text-left px-3 py-1.5 text-sm hover:bg-zinc-50', selected === g.id && 'text-indigo-600 font-medium')}>
                <span className="inline-flex items-center gap-1.5"><Folder className="w-3.5 h-3.5 text-zinc-400" />{g.name}</span>
              </button>
              <button onClick={() => onRename(g)} className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700"><Pencil className="w-3 h-3" /></button>
              <button onClick={() => onDelete(g)} className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 px-2 py-2 border-t border-zinc-100 mt-1">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New group…" className="flex-1 h-8 text-sm rounded-md border border-zinc-200 px-2" />
            <button onClick={() => { if (newName.trim()) { onCreate(newName.trim()); setNewName(''); } }} className="h-8 px-2.5 rounded-md bg-[#6366F1] text-white text-sm flex items-center"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}