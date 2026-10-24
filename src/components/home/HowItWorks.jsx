import React from 'react';

export default function HowItWorks({ settings }) {
  if (settings?.howitworks_enabled === false) return null;
  const steps = (settings?.howitworks_steps || [])
    .filter(s => s.enabled !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (!steps.length) return null;

  return (
    <section id="how" className="border-t border-white/[0.06] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          The process
        </p>
        <h2 className="mt-4 max-w-2xl font-heading text-[2.25rem] font-bold leading-[1.1] tracking-tight text-foreground md:text-5xl">
          {settings?.howitworks_heading || 'How It Works'}
        </h2>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={i} className="bg-background p-7 transition-colors duration-500 hover:bg-white/[0.02]">
              <span className="font-heading text-3xl font-bold text-primary/40">
                {String(s.sort_order || i + 1).padStart(2, '0')}
              </span>
              <p className="mt-5 text-base font-semibold text-foreground">{s.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
