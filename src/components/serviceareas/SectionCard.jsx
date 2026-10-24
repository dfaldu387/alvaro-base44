import React from 'react';

// Dark-themed section card for the zone editor.
export default function SectionCard({ title, description, actions, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-[#27272a] bg-[#1a1a1e] overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-[#222226] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}