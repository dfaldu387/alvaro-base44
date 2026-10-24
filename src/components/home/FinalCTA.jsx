import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin } from 'lucide-react';

export default function FinalCTA({ settings }) {
  const heading = settings?.finalcta_heading || 'Ready for your next cut?';
  const desc = settings?.finalcta_description || "Tell us where you are and when you're free.";

  return (
    <section className="relative overflow-hidden border-t border-white/[0.06] py-24 md:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-64 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/[0.12] blur-[150px]"
      />
      <div className="relative mx-auto max-w-3xl px-5 text-center">
        <h2 className="font-heading text-[2.5rem] font-bold leading-[1.05] tracking-tight text-foreground md:text-6xl">
          {heading}
        </h2>
        <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
          {desc}
        </p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row sm:items-center">
          <Link
            to={settings?.finalcta_primary_link || '/book'}
            className="group inline-flex items-center justify-center rounded-full bg-foreground py-2 pl-7 pr-2 text-[15px] font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 active:scale-[0.98]"
          >
            {settings?.finalcta_primary_label || 'Book Now'}
            <span className="ml-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105">
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </span>
          </Link>
          <a
            href={settings?.finalcta_secondary_link || '#areas'}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.02] px-7 py-3.5 text-[15px] font-medium text-foreground transition-colors duration-500 hover:border-primary/30 hover:bg-white/[0.04]"
          >
            <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            {settings?.finalcta_secondary_label || 'View Service Areas'}
          </a>
        </div>
      </div>
    </section>
  );
}
