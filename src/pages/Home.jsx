import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Scissors, Calendar } from 'lucide-react';
import SiteHeader from '@/components/home/SiteHeader';
import Hero from '@/components/home/Hero';
import TrustRow from '@/components/home/TrustRow';
import ServicesSection from '@/components/home/ServicesSection';
const ServiceAreaMap = lazy(() => import('@/components/home/ServiceAreaMap'));
import ServiceAreaCards from '@/components/home/ServiceAreaCards';
import HowItWorks from '@/components/home/HowItWorks';
import GroupBookingSection from '@/components/home/GroupBookingSection';
import AfterHoursSection from '@/components/home/AfterHoursSection';
import ValueSection from '@/components/home/ValueSection';
import FinalCTA from '@/components/home/FinalCTA';
import FAQSection from '@/components/home/FAQSection';
import SiteFooter from '@/components/home/SiteFooter';
import { setMapboxToken } from '@/lib/mapboxToken';

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    base44.functions.invoke('publicHomepageData', {})
      .then(res => { setData(res.data); setMapboxToken(res.data?.mapboxToken); })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-5">
        <div className="max-w-sm text-center">
          <span className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Scissors className="h-5 w-5 text-primary" strokeWidth={1.5} />
          </span>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">Cut Deluxe</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Some details are temporarily unavailable, but you can still book your cut.
          </p>
          <Link
            to="/book"
            className="group mt-8 inline-flex items-center justify-center rounded-full bg-foreground py-2 pl-7 pr-2 text-[15px] font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 active:scale-[0.98]"
          >
            Book now
            <span className="ml-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105">
              <Calendar className="h-4 w-4" strokeWidth={1.5} />
            </span>
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-white/[0.06] animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-3 w-24 rounded bg-muted/40 animate-pulse" />
              <div className="h-2 w-16 rounded bg-muted/20 animate-pulse" />
            </div>
          </div>
          <div className="h-9 w-24 rounded-xl bg-white/[0.06] animate-pulse" />
        </div>
        <div className="max-w-6xl mx-auto px-5 pt-16 pb-12">
          <div className="space-y-4">
            <div className="h-3 w-40 rounded bg-muted/40 animate-pulse" />
            <div className="h-12 w-72 rounded bg-muted/40 animate-pulse" />
            <div className="h-12 w-56 rounded bg-muted/30 animate-pulse" />
            <div className="h-4 w-80 rounded bg-muted/20 animate-pulse" />
            <div className="flex gap-3 mt-4">
              <div className="h-12 w-36 rounded-full bg-white/[0.06] animate-pulse" />
              <div className="h-12 w-40 rounded-full bg-muted/20 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { homepageSettings: s, faqs, services, addons, serviceAreas, groupDiscountSettings } = data;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader settings={s} />
      <Hero settings={s} />
      <TrustRow settings={s} />
      <ServicesSection settings={s} services={services} addons={addons} />

      {s?.areas_enabled !== false && serviceAreas?.length > 0 && (
        <section id="areas" className="py-16 md:py-24 border-t border-border">
          <div className="max-w-6xl mx-auto px-5">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground">{s?.areas_heading || 'Where We Come To You'}</h2>
            <p className="text-muted-foreground mt-3 max-w-2xl">{s?.areas_description}</p>
            {s?.areas_show_map !== false && (
              <div className="mt-8">
                <Suspense fallback={
                  <div className="rounded-3xl border border-border overflow-hidden h-[420px] md:h-[520px] flex items-center justify-center bg-card">
                    <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                }>
                  <ServiceAreaMap areas={serviceAreas} radiusSettings={groupDiscountSettings} />
                </Suspense>
              </div>
            )}
            {s?.areas_show_cards !== false && (
              <div className="mt-8"><ServiceAreaCards areas={serviceAreas} /></div>
            )}
            {s?.areas_show_priority_explainer !== false && (
              <div className="mt-8 rounded-2xl border border-border bg-card p-6 max-w-3xl">
                <p className="text-base font-semibold text-foreground">{s?.areas_outside_heading}</p>
                <p className="text-sm text-muted-foreground mt-1">{s?.areas_outside_text}</p>
              </div>
            )}
          </div>
        </section>
      )}

      <HowItWorks settings={s} />
      <GroupBookingSection settings={s} groupDiscountSettings={groupDiscountSettings} />
      <AfterHoursSection settings={s} />
      <ValueSection settings={s} />
      <FinalCTA settings={s} />
      <FAQSection settings={s} faqs={faqs} />
      <SiteFooter settings={s} />
    </div>
  );
}