import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function ServicesSection({ settings, services, addons }) {
  const list = (services || [])
    .filter(s => s.show_on_website !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (!list.length) return null;

  const heading = settings?.services_heading || 'Services & Pricing';
  const desc = settings?.services_description;
  const showAddons = settings?.services_show_addons !== false && (addons || []).length > 0;

  return (
    <section id="services" className="py-20 md:py-28">
      <div className="mx-auto max-w-4xl px-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          What we do
        </p>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-heading text-[2.25rem] font-bold leading-[1.1] tracking-tight text-foreground md:text-5xl">
            {heading}
          </h2>
          {desc && <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{desc}</p>}
        </div>

        {/* Editorial price list — hairlines, not boxes */}
        <ul className="mt-12">
          {list.map(s => (
            <li
              key={s.id}
              className="group flex items-baseline justify-between gap-6 border-t border-white/[0.07] py-6 transition-colors duration-500 last:border-b hover:border-primary/20"
            >
              <div className="min-w-0">
                <p className="text-lg font-medium text-foreground">{s.name}</p>
                {s.description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
                )}
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground/70">
                  {s.duration_mins} mins
                </p>
              </div>
              <p className="shrink-0 font-heading text-2xl font-bold text-foreground md:text-3xl">
                ${s.price}
              </p>
            </li>
          ))}
        </ul>

        {showAddons && (
          <div className="mt-12">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Add-ons
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              {addons.map(a => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.09] bg-white/[0.02] px-4 py-2 text-sm text-foreground"
                >
                  {a.name}
                  <span className="text-muted-foreground">+${a.price_adjustment || 0}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-14">
          <Link
            to="/book"
            className="group inline-flex items-center justify-center rounded-full bg-foreground py-2 pl-7 pr-2 text-[15px] font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 active:scale-[0.98]"
          >
            Book now
            <span className="ml-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105">
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
