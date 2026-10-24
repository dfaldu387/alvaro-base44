import React from 'react';
import { Timer, CheckCircle2, AlertTriangle } from 'lucide-react';

// One line per route: on time, or running N minutes late and which stop the estimate came from.
// This renders on BOTH the light Calendar and the deliberately dark in-van Route
// screen, so the muted tone uses theme tokens and follows body.admin-light rather
// than committing to one background. The two tinted tones are translucent and
// read on either.
function lineFor(route) {
  if (route.status !== 'ok') {
    return { tone: 'muted', text: `Live ETA unavailable: ${route.reason_text || 'no finalised route.'}` };
  }
  const from = route.anchor
    ? ` · from stop ${route.anchor.order}${route.anchor.client_name ? ` (${route.anchor.client_name.split(' ')[0]})` : ''}${route.anchor.kind === 'in_progress' ? ', in progress' : ''}`
    : ' · no stop has been timed yet';
  if (!route.delay_minutes) return { tone: 'ok', text: `On time${from}` };
  return { tone: 'late', text: `Running ${route.delay_minutes} minute${route.delay_minutes === 1 ? '' : 's'} late${from}` };
}

const TONE = {
  ok: { box: 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700', Icon: CheckCircle2 },
  late: { box: 'border-amber-500/40 bg-amber-500/[0.08] text-amber-700', Icon: AlertTriangle },
  muted: { box: 'border-border bg-card text-muted-foreground', Icon: Timer },
};

export default function RouteEtaLine({ routes, className = '', showUnavailable = true }) {
  const shown = (routes || []).filter(r => showUnavailable || r.status === 'ok');
  if (shown.length === 0) return null;
  return (
    <div className={`space-y-1.5 ${className}`}>
      {shown.map(route => {
        const { tone, text } = lineFor(route);
        const { box, Icon } = TONE[tone];
        return (
          <div key={route.route_id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold ${box}`}>
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="min-w-0">
              {shown.length > 1 && route.team_member_name ? `${route.team_member_name}: ` : ''}{text}
            </span>
          </div>
        );
      })}
    </div>
  );
}