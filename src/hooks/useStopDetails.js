import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { owedAtCheckout } from '@/lib/stopPayment';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);

/**
 * The booking record and its payment row for one stop, read only when its card is open.
 * One card is open at a time, so this is one read per expansion — no extra traffic on load.
 */
export default function useStopDetails(requestId, enabled) {
  const [booking, setBooking] = useState(null);
  const [payment, setPayment] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !requestId) return undefined;
    let live = true;
    Promise.all([
      base44.entities.BookingRequest.get(requestId).catch(() => null),
      base44.entities.BookingPayment.filter({ booking_request_id: requestId }, { limit: 1 }).catch(() => null),
    ]).then(([b, p]) => {
      if (!live) return;
      setBooking(b || null);
      setPayment(asList(p)[0] || null);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [requestId, enabled]);

  return { booking, payment, loaded, owing: payment ? owedAtCheckout(payment) : 0 };
}