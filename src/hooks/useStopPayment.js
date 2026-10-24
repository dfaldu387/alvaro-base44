import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { routePayment } from '@/lib/paymentApi';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);

// The payment of one stop, and the balance text's progress, with the two Route-tab actions.
export default function useStopPayment(requestId) {
  const [pay, setPay] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([
      base44.entities.BookingPayment.filter({ booking_request_id: requestId }, { limit: 1 }),
      base44.entities.MessageOutbox.filter({ idempotency_key: `sms|${requestId}|balance_request` }, { limit: 1 }),
    ]);
    setPay(asList(p)[0] || null);
    setMsg(asList(m)[0] || null);
  }, [requestId]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const act = useCallback(async (action) => {
    setBusy(true); setError(null);
    const res = await routePayment(action, requestId);
    if (!res.ok) setError(res.error);
    await load().catch(() => {});
    setBusy(false);
  }, [requestId, load]);

  return { pay, msg, busy, error, act };
}