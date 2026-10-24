import React from 'react';
import { Link } from 'react-router-dom';

// A one-line legal footer for the pages that have no SiteFooter — the booking
// flow and the status page. Those are where a customer actually hands over
// their details, so the links have to be reachable from there and not only
// from the home page.
export default function LegalLinks({ className = '' }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      <Link to="/terms" className="transition-colors duration-300 hover:text-foreground">Terms</Link>
      <span className="px-2 text-muted-foreground/40">·</span>
      <Link to="/privacy" className="transition-colors duration-300 hover:text-foreground">Privacy</Link>
    </p>
  );
}
