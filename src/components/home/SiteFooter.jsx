import React from 'react';
import { Link } from 'react-router-dom';
import { Scissors, Instagram, Phone, Mail } from 'lucide-react';

const EXPLORE = [
  { label: 'Book now', to: '/book', internal: true },
  { label: 'Services', to: '#services' },
  { label: 'Service areas', to: '#areas' },
  { label: 'How it works', to: '#how' },
  { label: 'FAQ', to: '#faq' },
];

export default function SiteFooter({ settings }) {
  const name = settings?.business_name || 'Cut Deluxe';
  const tagline = settings?.tagline || 'Mobile Barbering';

  const social = [
    settings?.instagram && { href: settings.instagram, Icon: Instagram, label: 'Instagram', external: true },
    settings?.phone && { href: `tel:${settings.phone}`, Icon: Phone, label: 'Phone' },
    settings?.email && { href: `mailto:${settings.email}`, Icon: Mail, label: 'Email' },
  ].filter(Boolean);

  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <Scissors className="h-4 w-4 text-primary" strokeWidth={1.5} />
              </span>
              <span>
                <span className="block font-heading text-[15px] font-bold tracking-tight text-foreground">{name}</span>
                <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{tagline}</span>
              </span>
            </div>

            {settings?.footer_text && (
              <p className="mt-6 max-w-xs text-sm leading-relaxed text-muted-foreground">{settings.footer_text}</p>
            )}

            {social.length > 0 && (
              <div className="mt-7 flex items-center gap-2.5">
                {social.map(({ href, Icon, label, external }) => (
                  <a
                    key={label}
                    href={href}
                    aria-label={label}
                    {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.09] text-muted-foreground transition-colors duration-500 hover:border-primary/30 hover:text-foreground"
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.5} />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Explore</p>
            <div className="mt-5 space-y-3">
              {EXPLORE.map(item => (item.internal ? (
                <Link key={item.label} to={item.to} className="block text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <a key={item.label} href={item.to} className="block text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground">
                  {item.label}
                </a>
              )))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Account</p>
            <div className="mt-5 space-y-3">
              <Link to="/status" className="block text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground">
                Check my booking
              </Link>
              <Link to="/login" className="block text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground">
                Barber login
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-white/[0.06] pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} {name}. Mobile barbering across Sydney.
          </p>
          <div className="flex items-center gap-5">
            <Link to="/terms" className="text-xs text-muted-foreground transition-colors duration-300 hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="text-xs text-muted-foreground transition-colors duration-300 hover:text-foreground">
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
