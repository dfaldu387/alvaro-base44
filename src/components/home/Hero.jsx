import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, MapPin } from 'lucide-react';

const EASE = [0.32, 0.72, 0, 1];

const rise = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

export default function Hero({ settings }) {
  if (settings?.hero_enabled === false) return null;

  const eyebrow = settings?.hero_eyebrow || 'SYDNEY MOBILE BARBERING';
  const headline = settings?.hero_headline || 'Premium Cuts.';
  const highlight = settings?.hero_highlight || 'At Your Door.';
  const desc = settings?.hero_description || 'Professional barbering brought directly to you.';
  const img = settings?.hero_image_url;
  const pLabel = settings?.hero_primary_cta_label || 'Book Now';
  const pLink = settings?.hero_primary_cta_link || '/book';
  const sLabel = settings?.hero_secondary_cta_label || 'View Service Areas';
  const sLink = settings?.hero_secondary_cta_link || '#areas';

  // No photo: a type-led centred hero. An empty image frame looks worse than none.
  const centred = !img;

  const Eyebrow = (
    <motion.span
      variants={rise}
      className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground"
    >
      {eyebrow}
    </motion.span>
  );

  const Headline = (
    <motion.h1
      variants={rise}
      className={`font-heading font-bold tracking-tight text-foreground ${
        centred
          ? 'mt-8 text-[3rem] leading-[1.02] sm:text-7xl lg:text-[5.25rem]'
          : 'mt-7 text-[2.75rem] leading-[1.04] sm:text-6xl lg:text-[4.25rem]'
      }`}
    >
      {headline}
      <br />
      <span className="italic text-primary">{highlight}</span>
    </motion.h1>
  );

  const Description = (
    <motion.p
      variants={rise}
      className={`text-base leading-relaxed text-muted-foreground md:text-lg ${
        centred ? 'mx-auto mt-7 max-w-xl' : 'mt-6 max-w-md'
      }`}
    >
      {desc}
    </motion.p>
  );

  const Actions = (
    <motion.div
      variants={rise}
      className={`mt-10 flex flex-col gap-3 sm:flex-row sm:items-center ${centred ? 'sm:justify-center' : ''}`}
    >
      <Link
        to={pLink}
        className="group inline-flex items-center justify-center rounded-full bg-foreground py-2 pl-7 pr-2 text-[15px] font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 active:scale-[0.98]"
      >
        {pLabel}
        <span className="ml-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105">
          <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
        </span>
      </Link>

      <a
        href={sLink}
        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.02] px-7 py-3.5 text-[15px] font-medium text-foreground transition-colors duration-500 hover:border-primary/30 hover:bg-white/[0.04]"
      >
        <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
        {sLabel}
      </a>
    </motion.div>
  );

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-64 h-[42rem] w-[42rem] rounded-full bg-primary/[0.14] blur-[160px] ${
          centred ? 'left-1/2 -translate-x-1/2' : 'left-1/4'
        }`}
      />

      {centred ? (
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative mx-auto max-w-3xl px-5 pb-20 pt-20 text-center md:pb-28 md:pt-28"
        >
          {Eyebrow}
          {Headline}
          {Description}
          {Actions}
        </motion.div>
      ) : (
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-14 md:pb-24 md:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16"
        >
          <div>
            {Eyebrow}
            {Headline}
            {Description}
            {Actions}
          </div>

          <motion.div
            variants={rise}
            className="relative rounded-[2rem] border border-white/[0.07] bg-white/[0.02] p-1.5"
          >
            <div className="overflow-hidden rounded-[calc(2rem-0.375rem)] border border-white/[0.05] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
              <img
                src={img}
                alt=""
                className="aspect-[4/5] w-full object-cover sm:aspect-[4/3] lg:aspect-[4/5]"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </section>
  );
}
