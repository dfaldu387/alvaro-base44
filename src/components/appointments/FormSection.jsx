import React from 'react';

/** One calm block of the create-appointment form: a heading, an optional hint, its fields. */
export default function FormSection({ title, hint, action, children }) {
  return (
    <section className="border-b border-zinc-100 px-6 py-6 last:border-0 md:px-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}