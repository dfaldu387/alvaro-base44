import React, { useState } from 'react';
import { Plus } from 'lucide-react';

export default function FAQSection({ settings, faqs }) {
  const [open, setOpen] = useState(null);
  if (settings?.faq_enabled === false) return null;
  const list = faqs || [];
  if (!list.length) return null;

  return (
    <section id="faq" className="border-t border-white/[0.06] py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Questions
        </p>
        <h2 className="mt-4 font-heading text-[2.25rem] font-bold leading-[1.1] tracking-tight text-foreground md:text-5xl">
          {settings?.faq_heading || 'FAQ'}
        </h2>

        {/* Hairline rows, not stacked boxes. The mark rotates to a minus rather
            than swapping icon, so the open state is one continuous movement. */}
        <div className="mt-12">
          {list.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.id} className="border-t border-white/[0.07] last:border-b">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 py-6 text-left"
                >
                  <span className="text-base font-medium text-foreground">{f.question}</span>
                  <Plus
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isOpen ? 'rotate-45' : ''}`}
                    strokeWidth={1.5}
                  />
                </button>
                {isOpen && (
                  <p className="-mt-1 max-w-xl pb-7 text-sm leading-relaxed text-muted-foreground">
                    {f.answer}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
