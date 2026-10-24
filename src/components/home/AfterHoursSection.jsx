import React from 'react';
import { Link } from 'react-router-dom';
import { Moon, ArrowRight } from 'lucide-react';

export default function AfterHoursSection({ settings }) {
  if (settings?.afterhours_enabled === false) return null;
  const heading = settings?.afterhours_heading || 'After-Hours Cuts';
  const desc = settings?.afterhours_description || 'Need a cut outside our regular route? Submit an after-hours request.';
  const price = settings?.afterhours_starting_price;
  const label = settings?.afterhours_cta_label || 'Request After Hours';
  const link = settings?.afterhours_cta_link || '/book';

  return (
    <section className="border-t border-white/[0.06] py-20 md:py-28">
      <div className="mx-auto max-w-4xl px-5">
        {/* Double bezel: outer shell, inner core with a concentric radius. */}
        <div className="rounded-[2rem] border border-white/[0.07] bg-white/[0.02] p-1.5">
          <div className="grid items-center gap-10 rounded-[calc(2rem-0.375rem)] border border-white/[0.06] bg-card p-8 md:grid-cols-[1.4fr_1fr] md:p-12">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />
                Outside the route
              </p>
              <h2 className="mt-4 font-heading text-[2rem] font-bold leading-[1.1] tracking-tight text-foreground md:text-4xl">
                {heading}
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">{desc}</p>

              <Link
                to={link}
                className="group mt-8 inline-flex items-center justify-center rounded-full bg-foreground py-2 pl-7 pr-2 text-[15px] font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 active:scale-[0.98]"
              >
                {label}
                <span className="ml-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105">
                  <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
                </span>
              </Link>
            </div>

            {price != null && (
              <div className="md:text-right">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Starting from</p>
                <p className="mt-2 font-heading text-5xl font-bold tracking-tight text-foreground md:text-6xl">${price}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
