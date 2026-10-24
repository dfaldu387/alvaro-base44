/**
 * SpecialHoursEditor — manage special hours / exceptions for specific dates.
 * Each entry: date, label, open/closed, start/end times, optional note.
 */
import React, { useState } from 'react';
import { Calendar, Plus, X, MoreVertical, Trash2 } from 'lucide-react';
import CompactTimePicker from '@/components/ui/CompactTimePicker';
import { decimalToLabel } from '@/lib/timeUtils';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

export default function SpecialHoursEditor({ specialHours, onChange }) {
  const list = Array.isArray(specialHours) ? specialHours : [];
  const [showAdd, setShowAdd] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);
  const [newEntry, setNewEntry] = useState({
    date: '',
    is_open: false,
    open_time: 9,
    close_time: 17,
    label: '',
    note: '',
  });

  const handleAdd = () => {
    if (!newEntry.date) return;
    const entry = { ...newEntry };
    onChange([...list, entry]);
    setNewEntry({ date: '', is_open: false, open_time: 9, close_time: 17, label: '', note: '' });
    setShowAdd(false);
  };

  const handleDelete = (index) => {
    onChange(list.filter((_, i) => i !== index));
    setMenuOpen(null);
  };

  const sorted = [...list].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return (
    <div>
      {/* Add button */}
      <button
        type="button"
        onClick={() => setShowAdd(p => !p)}
        className="flex items-center gap-1.5 text-sm font-semibold text-[#5E42F3] border border-[#5E42F3]/30 rounded-lg px-3 py-2 hover:bg-[#5E42F3]/5 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add special hours
      </button>

      {/* Add form */}
      {showAdd && (
        <div className="mt-3 bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-900">New Special Hours</p>
            <button onClick={() => setShowAdd(false)} className="text-zinc-400 hover:text-zinc-700"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-zinc-500 mb-1 block">Date</label>
              <input
                type="date"
                value={newEntry.date}
                onChange={e => setNewEntry(p => ({ ...p, date: e.target.value }))}
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-[#5E42F3]"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-500 mb-1 block">Label (optional)</label>
              <input
                value={newEntry.label}
                onChange={e => setNewEntry(p => ({ ...p, label: e.target.value }))}
                placeholder="e.g. ANZAC Day"
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setNewEntry(p => ({ ...p, is_open: !p.is_open }))}
              className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0',
                newEntry.is_open ? 'bg-[#5E42F3]' : 'bg-zinc-300')}
            >
              <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform',
                newEntry.is_open && 'translate-x-4')} />
            </button>
            <span className="text-sm font-medium text-zinc-700">{newEntry.is_open ? 'Open' : 'Closed'}</span>
          </div>

          {newEntry.is_open && (
            <div className="flex items-center gap-2">
              <CompactTimePicker value={newEntry.open_time} onChange={v => setNewEntry(p => ({ ...p, open_time: v }))} min={0} max={Math.max(newEntry.close_time - 0.25, 0.25)} />
              <span className="text-zinc-400 text-xs">to</span>
              <CompactTimePicker value={newEntry.close_time} onChange={v => setNewEntry(p => ({ ...p, close_time: v }))} min={newEntry.open_time + 0.25} max={24} />
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-zinc-500 mb-1 block">Note (optional)</label>
            <input
              value={newEntry.note}
              onChange={e => setNewEntry(p => ({ ...p, note: e.target.value }))}
              placeholder="e.g. Early closing"
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400"
            />
          </div>

          <button
            onClick={handleAdd}
            disabled={!newEntry.date}
            className="w-full bg-[#5E42F3] hover:bg-[#4F35E0] text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            Add Special Hours
          </button>
        </div>
      )}

      {/* Existing entries */}
      {sorted.length > 0 && (
        <div className="mt-3 space-y-2">
          {sorted.map((entry, i) => (
            <div key={i} className="flex items-center gap-3 bg-white border border-zinc-200 rounded-lg px-3 py-2.5">
              <Calendar className="w-4 h-4 text-zinc-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900">
                  {entry.date ? format(parseISO(entry.date), 'EEE, d MMM yyyy') : '—'}
                </p>
                {entry.label && <p className="text-xs text-zinc-500 truncate">{entry.label}</p>}
              </div>
              <div className="text-xs text-zinc-500 shrink-0">
                {entry.is_open ? `${decimalToLabel(entry.open_time)} to ${decimalToLabel(entry.close_time)}` : 'Closed'}
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={() => setMenuOpen(menuOpen === i ? null : i)}
                  className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 rounded-lg"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {menuOpen === i && (
                  <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 min-w-[120px]">
                    <button
                      onClick={() => handleDelete(i)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}