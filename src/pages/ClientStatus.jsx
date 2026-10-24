import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search, Clock, CheckCircle, XCircle, AlertCircle, Loader2, Calendar, CalendarX, CalendarClock, ChevronDown } from 'lucide-react';
import { useParams } from 'react-router-dom';
import BookingHeader from '@/components/booking/BookingHeader';
import LegalLinks from '@/components/legal/LegalLinks';
import TrackingCard from '@/components/status/TrackingCard';
import useTrackingToken from '@/components/status/useTrackingToken';
import { formatIsoDate } from '@/lib/bookingDateUtils';

// Every status BookingRequest can hold, so a customer is never shown the wrong
// one. The page used to carry four of the nine and fall back to "pending" for
// the rest, which told someone whose appointment was already finished — or who
// could not be fitted in — to wait for a confirmation that was never coming.
const STATUS_CONFIG = {
  pending: {
    icon: Clock,
    label: 'Pending',
    className: 'text-zinc-300 bg-white/[0.06]',
    message: 'Your appointment time will be confirmed at 7pm the night before.',
  },
  confirmed: {
    icon: CheckCircle,
    label: 'Confirmed',
    className: 'text-emerald-400 bg-emerald-400/10',
    message: null, // shown separately with the time
  },
  declined: {
    icon: XCircle,
    label: 'Declined',
    className: 'text-red-400 bg-red-400/10',
    message: 'Your request was not able to be accommodated. Please try booking another day.',
  },
  could_not_fit: {
    icon: XCircle,
    label: 'Could not fit',
    className: 'text-red-400 bg-red-400/10',
    message: "We couldn't fit this one into the day. Please try booking another day.",
  },
  waitlist: {
    icon: AlertCircle,
    label: 'Waitlist',
    className: 'text-amber-400 bg-amber-400/10',
    message: "You're on the waitlist. We'll confirm if a spot opens up.",
  },
  rescheduled: {
    icon: CalendarClock,
    label: 'Rescheduled',
    className: 'text-amber-400 bg-amber-400/10',
    message: 'This booking was moved. Check your messages for the new day and time.',
  },
  completed: {
    icon: CheckCircle,
    label: 'Completed',
    className: 'text-zinc-300 bg-white/[0.06]',
    message: 'This appointment is done. Thanks for choosing Cut Deluxe.',
  },
  no_show: {
    icon: CalendarX,
    label: 'Missed',
    className: 'text-zinc-300 bg-white/[0.06]',
    message: 'This appointment was marked as missed. Get in touch if that looks wrong.',
  },
  blocked: {
    icon: CalendarX,
    label: 'Not available',
    className: 'text-zinc-300 bg-white/[0.06]',
    message: 'This time is not available for booking.',
  },
};

// An unrecognised status is never dressed up as "pending". It says only what is
// certain — that we have the booking — and sends the customer to a person.
const UNKNOWN_STATUS = {
  icon: AlertCircle,
  label: 'Booked',
  className: 'text-zinc-300 bg-white/[0.06]',
  message: 'Reply to your confirmation message if you need an update on this one.',
};

export default function ClientStatus() {
  // /status/:token is the customer's own live-tracking link; /status is the name-and-phone search.
  // The search below stays available either way, for anyone who has lost the text.
  const { token } = useParams();
  const tracking = useTrackingToken(token);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const [loading, setLoading] = useState(false);
  // On a tracking link the card is the page, so the search starts folded away.
  const [searchOpen, setSearchOpen] = useState(!token);

  const canSearch = name.trim().length >= 2 && phone.trim().length >= 8;

  const handleSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    setLookupError(null);
    try {
      const res = await base44.functions.invoke('checkBookingStatus', {
        name: name.trim(),
        phone: phone.trim(),
      });
      setResults(res.data?.bookings || []);
    } catch (e) {
      // A throttled or failed lookup is NOT the same as "no such booking", and
      // telling someone their booking does not exist when we simply could not
      // check is the kind of message that makes them book somewhere else.
      setResults(null);
      setLookupError("We couldn't check that just now. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  const trackingPending = token && tracking === null;
  const trackingLive = token && tracking?.available === true;
  const trackingUnavailable = token && tracking && tracking.available !== true;

  return (
    <div className="min-h-[100dvh] bg-background">
      <BookingHeader />

      <div className="mx-auto w-full max-w-md px-5 pb-20 pt-10 lg:max-w-2xl lg:pt-16">
        <div className="text-center">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {token ? 'Your appointment' : 'Booking status'}
          </p>
          <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
            {token ? 'Where things stand' : 'Check your booking'}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {token
              ? 'This page updates on the day of your appointment.'
              : 'Enter the name and mobile number you booked with.'}
          </p>
        </div>

        {trackingPending && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {trackingLive && (
          <div className="mt-8">
            <TrackingCard view={tracking} />
          </div>
        )}

        {trackingUnavailable && (
          <p className="mt-8 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 text-center text-sm leading-relaxed text-muted-foreground">
            {tracking.message || 'This link is not active. Live tracking is only available on the day of your appointment.'}
          </p>
        )}

        {/* On a tracking link the search is a fallback, not the headline, so it
            sits behind a disclosure rather than competing with the card above. */}
        {token && !searchOpen && (
          <button
            onClick={() => setSearchOpen(true)}
            className="mx-auto mt-8 flex items-center gap-2 text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground"
          >
            Looking for a different booking?
            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}

        {searchOpen && (
          <div className={`rounded-[1.5rem] border border-white/[0.07] bg-white/[0.02] p-1.5 ${token ? 'mt-8' : 'mt-10'}`}>
            <div className="space-y-4 rounded-[calc(1.5rem-0.375rem)] border border-white/[0.06] bg-card p-6">
              <div className="space-y-2">
                <Label htmlFor="status-name">Full name</Label>
                <Input
                  id="status-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="As it appears on your booking"
                  autoComplete="name"
                  className="h-11 bg-background"
                  onKeyDown={e => e.key === 'Enter' && canSearch && handleSearch()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status-phone">Mobile number</Label>
                <Input
                  id="status-phone"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="04XX XXX XXX"
                  inputMode="tel"
                  autoComplete="tel"
                  className="h-11 bg-background"
                  onKeyDown={e => e.key === 'Enter' && canSearch && handleSearch()}
                />
              </div>

              <Button onClick={handleSearch} disabled={loading || !canSearch} className="h-11 w-full rounded-full font-semibold">
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</>
                  : <><Search className="h-4 w-4" strokeWidth={1.5} /> Check my booking</>}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Both have to match the booking before anything is shown.
              </p>
            </div>
          </div>
        )}

        {lookupError && (
          <p role="alert" className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-center text-sm text-amber-200">
            {lookupError}
          </p>
        )}

        {results !== null && results.length === 0 && (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            We couldn&apos;t find a booking matching those details.
          </p>
        )}

        {results && results.length > 0 && (
          <div className={`mt-10 grid gap-4 ${results.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {results.map(booking => {
              const cfg = STATUS_CONFIG[booking.status] || UNKNOWN_STATUS;
              const Icon = cfg.icon;
              return (
                <div key={booking.id} className="rounded-2xl border border-white/[0.07] bg-card p-5">
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${cfg.className}`}>
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="text-sm font-semibold">{cfg.label}</span>
                  </div>

                  {booking.status === 'confirmed' && booking.assigned_time && (
                    <div className="py-5 text-center">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Confirmed for</p>
                      <p className="mt-1.5 font-heading text-4xl font-bold text-foreground">{booking.assigned_time}</p>
                    </div>
                  )}

                  {cfg.message && (
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{cfg.message}</p>
                  )}

                  <dl className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-4 text-sm">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" strokeWidth={1.5} /> Day
                      </dt>
                      <dd className="text-right font-medium text-foreground">
                        {formatIsoDate(booking.requested_date) || booking.day}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-muted-foreground">Availability</dt>
                      <dd className="text-right font-medium text-foreground">{booking.availability_window}</dd>
                    </div>
                    {booking.services && booking.services.length > 0 && (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-muted-foreground">Service</dt>
                        <dd className="text-right font-medium text-foreground">{booking.services.join(', ')}</dd>
                      </div>
                    )}
                    {booking.notes && (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="shrink-0 text-muted-foreground">Notes</dt>
                        <dd className="text-right font-medium text-foreground">{booking.notes}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        )}

        <LegalLinks className="mt-16 border-t border-white/[0.06] pt-6 text-center" />
      </div>
    </div>
  );
}
