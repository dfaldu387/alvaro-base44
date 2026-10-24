import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CalendarCheck, CalendarDays, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CalendarImportPanel from '@/components/staff/CalendarImportPanel';

/**
 * CalendarSyncCard — "connect my Google Calendar", for the person signed in.
 *
 * Each barber connects their OWN Google account, so the appointment blocks of a
 * route they finalise land in their own calendar.
 *
 * Whether the calendar is connected comes from the backend (getCalendarStatus),
 * which verifies the connection with Google: it answers when connected and
 * refuses when not, so there is no second idea of "connected" to drift.
 */
const CONNECTOR_ID = '6acfeb0637dedce6cedcd553';

export default function CalendarSyncCard() {
  const [status, setStatus] = useState(null);
  const [signedIn, setSignedIn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await base44.functions.invoke('getCalendarStatus', {});
      setStatus(res?.data?.connected ? res.data : null);
    } catch {
      setStatus(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    base44.auth.isAuthenticated().then(async (authed) => {
      setSignedIn(authed);
      if (!authed) {
        setLoading(false);
        return;
      }
      await check();
    });
  }, [check]);

  const connect = async () => {
    setBusy(true);
    try {
      const url = await base44.connectors.connectAppUser(CONNECTOR_ID);
      const popup = window.open(url, '_blank');
      if (!popup) {
        setBusy(false);
        return;
      }
      // The consent tab closes when they are done; that is the only signal the page gets.
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          check();
          setBusy(false);
        }
      }, 500);
    } catch {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await base44.connectors.disconnectAppUser(CONNECTOR_ID);
    } catch {
      /* nothing was connected to revoke */
    }
    setStatus(null);
    setBusy(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking your Google Calendar…
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">Sign in to connect your Google Calendar.</p>
        <Button variant="outline" onClick={() => base44.auth.redirectToLogin()}>Sign in</Button>
      </div>
    );
  }

  if (status) {
    const count = Number(status.synced_count) || 0;
    return (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <CalendarCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900">Your Google Calendar is connected</p>
              <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                {count > 0 ? `${count} appointment block${count === 1 ? '' : 's'} synced so far. ` : ''}
                Finalising a route adds its appointments to your own calendar.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={disconnect} disabled={busy}>
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
        <CalendarImportPanel info={status.import} onChanged={check} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <CalendarDays className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">Sync appointments to your own calendar</p>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            Connect your Google Calendar once. Every time you finalise a route, its appointment blocks are added
            to your own calendar — re-finalising updates them instead of adding copies.
          </p>
        </div>
      </div>
      <Button onClick={connect} disabled={busy}>{busy ? 'Connecting…' : 'Connect Google Calendar'}</Button>
    </div>
  );
}