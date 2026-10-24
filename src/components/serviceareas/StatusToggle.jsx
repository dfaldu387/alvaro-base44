import React from 'react';
import Switch from './Switch';

// Dark-themed status toggle with helper text.
export default function StatusToggle({ active, onChange, disabled }) {
  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5">
        <Switch checked={active} onChange={onChange} disabled={disabled} label={active ? 'Active' : 'Inactive'} />
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold leading-5 ${active ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {active ? 'Active' : 'Inactive'}
        </p>
        <p className="text-xs text-zinc-500 leading-4 mt-1">
          {active ? 'This zone will be shown on your website' : 'Stored in admin only — not shown publicly'}
        </p>
      </div>
    </div>
  );
}