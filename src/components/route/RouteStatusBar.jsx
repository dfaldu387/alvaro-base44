import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import { fmtRouteMins } from '@/lib/dayRouteStatus';

/**
 * Where this day stands — one compact banner, never repeated.
 *
 * The Route tab is the execution layer, so it always says which of the two it is
 * showing, and when a connected route no longer matches the day it says so instead
 * of presenting an out-of-date route as current.
 *
 * The out-of-date warning can be dismissed (the X, Escape, or a click outside it),
 * because a barber mid-day does not need it in the way. Dismissing it never resolves
 * anything: the day stays out of date until Reconnect Appointments rebuilds it, and a
 * small "Route out of date" strip stays on screen for as long as that is true.
 */
export default function RouteStatusBar({ state, busy, onReconnect, error }) {
  const status = busy ? 'finalising' : (state?.status || 'draft');
  const stale = status === 'needs_update';
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef(null);

  // A new reason (the day changed again) reopens the warning by itself.
  useEffect(() => { setDismissed(false); }, [state?.reason, status]);

  useEffect(() => {
    if (!stale || dismissed) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDismissed(true); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setDismissed(true); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [stale, dismissed]);

  if (stale && dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="mx-4 mb-3 flex w-[calc(100%-2rem)] items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-left"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="flex-1 text-[11px] font-semibold text-amber-500">Route out of date — the times below are the previous route</span>
        <span className="text-[11px] font-bold text-amber-500">Show</span>
      </button>
    );
  }

  if (status === 'finalising') {
    return (
      <Wrapper tone="muted">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        <Body title="Reconnecting the day…" tone="muted">
          Recalculating travel and re-checking the route.
        </Body>
      </Wrapper>
    );
  }

  if (status === 'finalised') {
    return (
      <Wrapper tone="done">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        <Body title="Route connected" tone="done">
          {state?.appointments || 0} stop{state?.appointments === 1 ? '' : 's'} · {fmtRouteMins(state?.drive_minutes)} driving ·{' '}
          {fmtRouteMins(state?.idle_minutes)} idle
        </Body>
      </Wrapper>
    );
  }

  if (stale) {
    return (
      <div ref={ref} className={wrapperClass('warn')}>
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-amber-600">Route needs updating</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {state?.reason || 'The day changed after the route was connected'}. Press Reconnect Appointments to update the
            times and driving.
          </p>
          {error && <p className="mt-1 text-[11px] font-semibold text-red-500">{error}</p>}
        </div>
        <button
          type="button"
          onClick={onReconnect}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" /> Reconnect Appointments
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss route warning"
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <Wrapper tone="muted">
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Body title="Not connected yet" tone="muted">
        This day is still a plan. Arrange it on the Calendar, then press Connect Appointments to build the route.
      </Body>
      <Link to="/admin/schedule" className="shrink-0 rounded-xl border border-border bg-secondary px-3 py-1.5 text-[11px] font-semibold text-foreground">
        Open Calendar
      </Link>
    </Wrapper>
  );
}

function wrapperClass(tone) {
  const styles = {
    done: 'border-green-500/30 bg-green-500/[0.06]',
    warn: 'border-amber-500/40 bg-amber-500/[0.07]',
    muted: 'border-border bg-card',
  };
  return `mx-4 mb-3 flex items-start gap-2.5 rounded-2xl border px-4 py-3 ${styles[tone]}`;
}

function Wrapper({ tone, children }) {
  return <div className={wrapperClass(tone)}>{children}</div>;
}

function Body({ title, tone, children }) {
  return (
    <div className="min-w-0 flex-1">
      <p className={`text-[12px] font-bold ${tone === 'done' ? 'text-green-600' : 'text-foreground'}`}>{title}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}