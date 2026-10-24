import React from 'react';
import { getHomeIcon } from '@/lib/homeIcons';

export default function TrustRow({ settings }) {
  if (settings?.trust_enabled === false) return null;
  const items = (settings?.trust_items || [])
    .filter(i => i.enabled !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (!items.length) return null;

  return (
    <section className="border-y border-white/[0.06]">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-8 px-5 py-10 md:grid-cols-4 md:py-12">
        {items.map((it, i) => {
          const Icon = getHomeIcon(it.icon);
          return (
            <div key={i} className="flex flex-col gap-3">
              <Icon className="h-5 w-5 text-primary" strokeWidth={1.25} />
              <div>
                <p className="text-sm font-medium text-foreground">{it.label}</p>
                {it.description && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{it.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
