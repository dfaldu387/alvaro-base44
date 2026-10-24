import React from 'react';
import { getHomeIcon } from '@/lib/homeIcons';

export default function ValueSection({ settings }) {
  if (settings?.value_enabled === false) return null;
  const items = (settings?.value_items || [])
    .filter(i => i.enabled !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (!items.length) return null;

  return (
    <section className="border-t border-white/[0.06] py-20 md:py-28">
      <div className="mx-auto max-w-4xl px-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Why us
        </p>
        <h2 className="mt-4 max-w-2xl font-heading text-[2.25rem] font-bold leading-[1.1] tracking-tight text-foreground md:text-5xl">
          {settings?.value_heading || 'Why Cut Deluxe'}
        </h2>

        {/* Hairline grid rather than icon tiles in boxes — the icon is a mark,
            not a badge, so it sits at the same weight as the text. */}
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-white/[0.07] sm:grid-cols-2">
          {items.map((it, i) => {
            const Icon = getHomeIcon(it.icon);
            return (
              <div key={i} className="bg-background p-7">
                <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                <p className="mt-5 text-base font-medium text-foreground">{it.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
