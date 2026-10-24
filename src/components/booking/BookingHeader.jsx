import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';

// A slim header for the public pages a customer lands on mid-journey — the
// booking flow and the status page. It tells them whose site this is and gives
// them a way out without reaching for the browser's back button.
export default function BookingHeader() {
  return (
    <header className="border-b border-white/[0.06]">
      <div className="mx-auto flex h-16 max-w-md items-center justify-between px-5 lg:h-20 lg:max-w-6xl lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="font-heading text-[15px] font-bold tracking-tight text-foreground">Cut Deluxe</span>
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-300 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Exit
        </Link>
      </div>
    </header>
  );
}