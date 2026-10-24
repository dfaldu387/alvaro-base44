import React, { useState } from 'react';
import { X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ALL_COLUMNS } from '@/components/clients/ColumnSelector';

const SCOPES = [
  { key: 'all', label: 'All clients' },
  { key: 'filtered', label: 'Current filtered results' },
  { key: 'selected', label: 'Selected clients', needsSelection: true },
  { key: 'group', label: 'Current group', needsGroup: true },
  { key: 'inactive', label: 'Inactive clients' },
  { key: 'recurring', label: 'Recurring clients' },
  { key: 'weekly', label: 'Weekly clients' },
  { key: 'flexible', label: 'Flexible clients' },
  { key: 'fixed_time', label: 'Fixed Time clients' },
  { key: 'fixed_window', label: 'Fixed Window clients' },
];

export default function ExportDialog({ open, onClose, onExport, hasSelection, hasGroup, groupName }) {
  const [scope, setScope] = useState('all');
  const [cols, setCols] = useState(ALL_COLUMNS.map(c => c.key));
  if (!open) return null;
  const toggleCol = (k) => setCols(c => c.includes(k) ? c.filter(x => x !== k) : [...c, k]);
  return (
    <div className="fixed inset-0 z-[70] flex justify-center items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border border-zinc-200 rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="text-base font-bold text-zinc-900">Export clients</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Which clients?</p>
          <div className="grid grid-cols-2 gap-1.5 mb-5">
            {SCOPES.map(s => {
              const disabled = (s.needsSelection && !hasSelection) || (s.needsGroup && !hasGroup);
              return (
                <button key={s.key} disabled={disabled} onClick={() => setScope(s.key)} className={cn('text-left px-3 py-2 rounded-lg text-sm border', scope === s.key ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50', disabled && 'opacity-40 cursor-not-allowed')}>
                  {s.label}{s.needsGroup && groupName ? ` (${groupName})` : ''}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Which columns?</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_COLUMNS.map(c => (
              <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 cursor-pointer">
                <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} disabled={c.locked} className="w-4 h-4 rounded border-zinc-300 text-indigo-600 disabled:opacity-50" />
                <span className="text-sm text-zinc-700">{c.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-100">
          <Button variant="ghost" className="text-zinc-500 hover:bg-zinc-100" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onExport(scope, cols)} disabled={cols.length === 0} className="bg-[#6366F1] hover:bg-[#5457e6] text-white"><Download className="w-4 h-4" /> Export CSV</Button>
        </div>
      </div>
    </div>
  );
}