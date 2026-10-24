import React from 'react';
import { Link } from 'react-router-dom';
import { Users, ArrowRight } from 'lucide-react';
import { getApplicableTier } from '@/lib/groupPricing';

export default function GroupBookingSection({ settings, groupDiscountSettings }) {
  if (settings?.group_enabled === false) return null;
  const heading = settings?.group_heading || 'Cutting the whole crew?';
  const desc = settings?.group_description || 'Book two or more people at the same address and save.';
  const enabled = groupDiscountSettings && groupDiscountSettings.enabled !== false;
  const tiers = [2, 3, 4]
    .map(n => ({ n, tier: getApplicableTier(n, groupDiscountSettings) }))
    .filter(t => t.tier && t.tier.amount);

  return (
    <section className="border-t border-white/[0.06] py-20 md:py-28">
      <div className="mx-auto max-w-4xl px-5">
        <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
          Group bookings
        </p>
        <h2 className="mt-4 max-w-2xl font-heading text-[2.25rem] font-bold leading-[1.1] tracking-tight text-foreground md:text-5xl">
          {heading}
        </h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">{desc}</p>

        {enabled && tiers.length ? (
          /* The saving is the point, so it is set in the display face and the
             rest of the cell stays quiet. Hairlines, not boxes. */
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-white/[0.07] sm:grid-cols-3">
            {tiers.map(({ n, tier }) => (
              <div key={n} className="bg-background p-7">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {n}{n >= 4 ? '+' : ''} people
                </p>
                <p className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground">
                  {tier.type === 'percentage' ? `${tier.amount}%` : `$${tier.amount}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">off the total</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-10 text-sm text-foreground">Group bookings available.</p>
        )}

        <Link
          to="/book"
          className="group mt-12 inline-flex items-center justify-center rounded-full bg-foreground py-2 pl-7 pr-2 text-[15px] font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 active:scale-[0.98]"
        >
          Book a group
          <span className="ml-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105">
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          </span>
        </Link>
      </div>
    </section>
  );
}
