/**
 * CreateMenu — the quick-action menu behind "+ New".
 * Two creation paths: a manual appointment, or blocked time. Booking requests are
 * handled in the dedicated Booking Requests panel, never from here.
 */
import React from 'react';
import { X, CalendarPlus, Ban } from 'lucide-react';

const ACTIONS = [
  { key: 'booking', Icon: CalendarPlus, label: 'Create appointment', sub: 'Exact time or an availability window' },
  { key: 'block', Icon: Ban, label: 'Block Time', sub: 'Lunch, personal, unavailable' },
];

export default function CreateMenu({ onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-white border-t border-zinc-200 rounded-t-3xl p-4 pb-8 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-zinc-900">New Appointment</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-zinc-100 transition-all">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
        <div className="space-y-2">
          {ACTIONS.map(({ key, Icon, label, sub }) => (
            <button
              key={key}
              onClick={() => { onClose(); onSelect(key); }}
              className="w-full flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-2xl p-4 hover:bg-violet-50 hover:border-violet-200 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-violet-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-zinc-800">{label}</p>
                <p className="text-xs text-zinc-500 leading-tight mt-0.5">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}