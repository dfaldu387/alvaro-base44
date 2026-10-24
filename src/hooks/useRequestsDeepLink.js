import { useEffect, useState } from 'react';
import { isNeedsAction, requestState } from '@/lib/requestStatus';

/**
 * Booking requests are handled inside the Calendar's Booking Requests drawer, so an
 * address that used to open a separate Requests or Needs Review page lands here.
 *
 * This opens the drawer on the filter that address named, and — because the drawer
 * lists one day at a time — moves the calendar to the nearest date that actually has
 * a request in that state, so an old Needs Review link opens on the requests it was
 * about rather than on an empty list.
 *
 * Returns the filter the drawer should start on.
 */
export default function useRequestsDeepLink({ openPanel, requests, allRequests, loaded, onFocusDate }) {
  const [initialFilter, setInitialFilter] = useState('all');
  const [pending, setPending] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('requests') !== 'open') return;
    const filter = params.get('filter') || 'all';
    setInitialFilter(filter);
    setPending(filter === 'all' ? null : filter);
    openPanel();
  }, [openPanel]);

  useEffect(() => {
    if (!pending || !loaded) return;
    // Once only: the jump below changes the day, which changes the list it read.
    setPending(null);
    if (requests.some(r => requestState(r) === pending)) return;
    const next = allRequests
      .filter(r => isNeedsAction(r) && requestState(r) === pending && r.requested_date)
      .sort((a, b) => String(a.requested_date).localeCompare(String(b.requested_date)))[0];
    if (next) onFocusDate(new Date(`${next.requested_date}T00:00:00`));
  }, [pending, loaded, requests, allRequests, onFocusDate]);

  return initialFilter;
}