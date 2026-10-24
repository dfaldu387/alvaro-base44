import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { owedAtCheckout, settledAtCheckout } from '@/lib/stopPayment';
import {
  completeCheckout, editServices, loadCheckoutPayment, payCard, payOffline, setReminder,
} from '@/lib/routeCheckoutApi';
import CheckoutPanel from './CheckoutPanel';
import NextHaircutPanel from './NextHaircutPanel';

const POLL_MS = 3000;
const POLL_TRIES = 40;

/**
 * The checkout flow for one client: checkout (closed until it is opened) → payment →
 * next haircut, back to the execution list.
 *
 * Square owns the payment answer: a card payment only advances when the provider's own
 * record says the money arrived. Paying is what completes the appointment — there is no
 * separate start or complete step to press.
 */
export default function StopCheckout({ stop, execution, catalogue, onClose, onChanged }) {
  const [stage, setStage] = useState('checkout'); // checkout | processing | next_haircut
  const [booking, setBooking] = useState(null);
  const [payment, setPayment] = useState(null);
  const [client, setClient] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [waited, setWaited] = useState(false);
  const [paid, setPaid] = useState(false);
  const [outstanding, setOutstanding] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const b = await base44.entities.BookingRequest.get(stop.requestId).catch(() => null);
      if (cancelled || !b) return;
      setBooking(b);
      const [p, c] = await Promise.all([
        loadCheckoutPayment(stop.requestId).catch(() => null),
        b.client_id ? base44.entities.ReminderClient.get(b.client_id).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setPayment(p);
      setClient(c);
    })();
    return () => { cancelled = true; };
  }, [stop.requestId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Paying completes the appointment; the next step is only reached from here.
  const settle = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await completeCheckout(stop.requestId, execution?.updatedDate);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOutstanding(Number(res.outstanding) || 0);
    onChanged();
    setStage('next_haircut');
  }, [stop.requestId, execution, onChanged]);

  // Wait for Square to confirm. The link opens on another screen, so nothing here
  // decides that a card payment succeeded.
  useEffect(() => {
    if (stage !== 'processing') return undefined;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const p = await loadCheckoutPayment(stop.requestId).catch(() => null);
      if (p) setPayment(p);
      if (p && settledAtCheckout(p)) {
        clearInterval(timer);
        setPaid(true);
        settle();
        return;
      }
      if (tries >= POLL_TRIES) { clearInterval(timer); setWaited(true); }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [stage, stop.requestId, settle]);

  const handlePayCard = async () => {
    setBusy(true);
    setError(null);
    const res = await payCard(stop.requestId);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    window.open(res.url, '_blank', 'noopener');
    setPayment(await loadCheckoutPayment(stop.requestId).catch(() => null));
    setWaited(false);
    setStage('processing');
  };

  const handlePayOffline = async (method) => {
    setBusy(true);
    setError(null);
    const res = await payOffline(stop.requestId, method);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setPayment(res.payment);
    setPaid(true);
    await settle();
  };

  const handleCheck = async () => {
    setBusy(true);
    const p = await loadCheckoutPayment(stop.requestId).catch(() => null);
    setBusy(false);
    if (p) setPayment(p);
    setWaited(false);
    if (p && settledAtCheckout(p)) { setPaid(true); await settle(); }
    else setNote('Square has not confirmed a payment for this appointment yet.');
  };

  const handleSaveServices = async (services) => {
    setError(null);
    setNote(null);
    const res = await editServices(stop.requestId, services);
    if (!res.ok) { setError(res.error); return false; }
    setBooking(prev => ({ ...(prev || {}), services: res.services, participants: res.participants, subtotal: res.subtotal, price: res.total, group_discount: res.group_discount, duration_mins: res.duration_mins }));
    setPayment(await loadCheckoutPayment(stop.requestId).catch(() => null));
    onChanged();
    return true;
  };

  const handleAddReminder = async (frequency, customDate) => {
    setBusy(true);
    setError(null);
    const res = await setReminder(stop.requestId, frequency, customDate);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onChanged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 lg:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card shadow-2xl lg:rounded-3xl">
        {stage === 'next_haircut' ? (
          <NextHaircutPanel
            client={client || (booking ? { client_name: booking.client_name, frequency: null } : null)}
            visitDate={booking?.requested_date || ''}
            paid={paid}
            outstanding={outstanding}
            busy={busy}
            error={error}
            onAdd={handleAddReminder}
            onSkip={onClose}
          />
        ) : (
          <CheckoutPanel
            stop={stop}
            booking={booking}
            catalogue={catalogue}
            owing={owedAtCheckout(payment)}
            busy={busy}
            error={error}
            processing={stage === 'processing'}
            waited={waited}
            note={note}
            onClose={onClose}
            onPayCard={handlePayCard}
            onOffline={handlePayOffline}
            onCheck={handleCheck}
            onComplete={settle}
            onSaveServices={handleSaveServices}
          />
        )}
      </div>
    </div>
  );
}