import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';

// Shared shell for Terms and Privacy. Same dark public theme as the rest of
// the site, a reading measure rather than full width, and — by default — a
// standing notice that the wording is a draft, so a page that has not been
// settled yet cannot read as final. A page that is final passes
// draftNotice={false}.
export default function LegalPage({ title, updated, draftNotice = true, children }) {
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5 lg:h-20">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-heading text-[15px] font-bold tracking-tight text-foreground">Cut Deluxe</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-300 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-14 lg:pt-20">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Legal</p>
        <h1 className="mt-4 font-heading text-[2.25rem] font-bold leading-[1.1] tracking-tight text-foreground md:text-5xl">
          {title}
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated {updated}</p>

        {draftNotice && (
          <div className="mt-10 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.5} />
            <p className="text-sm leading-relaxed text-amber-100/90">
              <span className="font-semibold">Draft — not yet reviewed.</span>{' '}
              This page describes how Cut Deluxe actually works today, so there is something real to
              review. It has not been checked by a lawyer and is not a final agreement. Please do not
              rely on it.
            </p>
          </div>
        )}

        <div className="mt-12 space-y-10">{children}</div>

        <p className="mt-16 border-t border-white/[0.07] pt-7 text-sm leading-relaxed text-muted-foreground">
          Questions about this page? Reply to any message from us, or use the contact details on the{' '}
          <Link to="/" className="text-foreground underline underline-offset-4">home page</Link>.
        </p>
      </main>
    </div>
  );
}

// One titled section of a legal page.
export function LegalSection({ heading, children }) {
  return (
    <section>
      <h2 className="font-heading text-xl font-bold tracking-tight text-foreground">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}