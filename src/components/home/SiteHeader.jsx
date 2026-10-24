import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';

const NAV = [
  { label: 'Services', href: '#services' },
  { label: 'Service Areas', href: '#areas' },
  { label: 'How It Works', href: '#how' },
  { label: 'FAQ', href: '#faq' },
];

const EASE = [0.32, 0.72, 0, 1];

export default function SiteHeader({ settings }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef(null);

  // IntersectionObserver instead of a scroll listener: no continuous reflow.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), {
      rootMargin: '-8px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Never leave the page scroll-locked behind an open overlay.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const name = settings?.business_name || 'Cut Deluxe';
  const tagline = settings?.tagline || 'Mobile Barbering';

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="absolute top-0 h-px w-full" />

      <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6">
        <div
          className={`mx-auto flex h-16 max-w-6xl items-center justify-between rounded-full px-4 pr-3 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] sm:px-6 sm:pr-4 ${
            scrolled
              ? 'border border-white/[0.08] bg-background/70 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl'
              : 'border border-transparent bg-transparent'
          }`}
        >
          <Link to="/" className="group flex items-center gap-3">
            <LogoMark className="h-9 w-9" />
            <span className="leading-none">
              <span className="block font-heading text-[15px] font-bold tracking-tight text-foreground">{name}</span>
              <span className="mt-1 block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{tagline}</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map(n => (
              <a
                key={n.href}
                href={n.href}
                className="relative text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground after:absolute after:-bottom-1.5 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all after:duration-500 after:ease-[cubic-bezier(0.32,0.72,0,1)] hover:after:w-full"
              >
                {n.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/book"
              className="group hidden h-10 items-center rounded-full bg-foreground pl-5 pr-1.5 text-sm font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 active:scale-[0.98] sm:inline-flex"
            >
              Book now
              <span className="ml-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </span>
            </Link>

            <button
              className="flex h-10 w-10 items-center justify-center rounded-full md:hidden"
              onClick={() => setOpen(v => !v)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
            >
              <span className="relative block h-3 w-5">
                <span
                  className={`absolute left-0 block h-px w-5 bg-foreground transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    open ? 'top-1.5 rotate-45' : 'top-0'
                  }`}
                />
                <span
                  className={`absolute left-0 block h-px w-5 bg-foreground transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    open ? 'top-1.5 -rotate-45' : 'top-3'
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="fixed inset-0 z-30 bg-background/90 backdrop-blur-2xl md:hidden"
          >
            <div className="flex h-full flex-col justify-center px-8">
              {NAV.map((n, i) => (
                <motion.a
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: EASE, delay: 0.06 + i * 0.05 }}
                  className="border-b border-white/[0.06] py-5 font-heading text-3xl font-bold tracking-tight text-foreground"
                >
                  {n.label}
                </motion.a>
              ))}

              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.3 }}
                className="mt-10 space-y-4"
              >
                <Link
                  to="/book"
                  onClick={() => setOpen(false)}
                  className="group inline-flex h-12 w-full items-center rounded-full bg-foreground pl-6 pr-2 text-[15px] font-semibold text-background active:scale-[0.98]"
                >
                  <span className="flex-1 text-center">Book now</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/10">
                    <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
                  </span>
                </Link>
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  className="block text-center text-xs text-muted-foreground/70"
                >
                  Barber login
                </Link>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}