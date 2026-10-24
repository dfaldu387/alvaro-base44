import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

// How long the Review step waits for a quote before giving up on it.
const QUOTE_TIMEOUT_MS = 4000;

/**
 * The deposit the server expects to ask for, shown on the Review step before submitting.
 *
 * Display only. Nothing here is sent to submitPublicBooking, which makes its own decision. The quote is
 * never allowed to get in the way: while it is loading, or if it errors, times out or returns nothing,
 * this simply returns null and the page behaves exactly as if there were no quote.
 *
 * Pass the booking payload to quote it, or null to do nothing.
 */
export default function useDepositQuote(payload) {
  const [quote, setQuote] = useState(null);
  const key = payload ? JSON.stringify(payload) : '';

  useEffect(() => {
    setQuote(null);
    if (!key) return undefined;
    let live = true;
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('QUOTE_TIMEOUT')), QUOTE_TIMEOUT_MS); });
    Promise.race([base44.functions.invoke('publicDepositQuote', JSON.parse(key)), timeout])
      .then((res) => {
        const d = res?.data;
        const amount = Number(d?.amount);
        if (live && d?.required === true && amount > 0) setQuote({ amount, line: typeof d.line === 'string' ? d.line : '' });
      })
      .catch(() => { /* a failed quote is simply no quote */ })
      .finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); };
  }, [key]);

  return quote;
}