import React from 'react';
import { codeLabel, formatMinutes, outcomeLabel, triggerLabel } from '@/lib/routeFlowActivity';

/**
 * Expanded activity detail. Booking request ids and times only — no client
 * names, addresses or contact details ever reach this panel.
 */
export default function ActivityDetailPanel({ item }) {
  const facts = [
    ['What triggered it', triggerLabel(item.triggerType)],
    ['Actor', item.actorType === 'admin' ? `Admin — ${item.actor}` : 'Route Flow (automatic)'],
    ['Day affected', item.scheduleDate || '—'],
    ['Barber', item.barberName || '—'],
    ['Outcome', outcomeLabel(item.outcome)],
  ];

  const changes = item.moves.length > 0
    ? item.moves
    : (item.fromLabel || item.toLabel
      ? [{ booking_request_id: item.requestIds[0] || null, from_label: item.fromLabel || 'Unscheduled', to_label: item.toLabel || item.fromLabel || '' }]
      : []);

  const drive = formatMinutes(item.metrics.driveBefore, item.metrics.driveAfter);
  const idle = formatMinutes(item.metrics.idleBefore, item.metrics.idleAfter);

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3.5 py-3 space-y-3">
      <Section title="What happened">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {facts.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-zinc-500">{label}</span>
              <span className="text-[11px] font-semibold text-zinc-700 text-right">{value}</span>
            </div>
          ))}
        </div>
      </Section>

      {changes.length > 0 && (
        <Section title={changes.length === 1 ? 'Appointment change' : `Appointment changes (${changes.length})`}>
          <div className="space-y-1">
            {changes.map((c, i) => (
              <div key={c.booking_request_id || i} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="text-zinc-500 font-mono">{c.booking_request_id ? `#${String(c.booking_request_id).slice(-6)}` : 'Request'}</span>
                <span className="font-semibold text-zinc-700">
                  {c.from_label || 'Unscheduled'} <span className="text-zinc-400">→</span> {c.to_label || '—'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(drive || idle) && (
        <Section title="Day cost">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
            {drive && <span className="text-zinc-500">Driving <span className="font-semibold text-zinc-700">{drive}</span></span>}
            {idle && <span className="text-zinc-500">Idle <span className="font-semibold text-zinc-700">{idle}</span></span>}
          </div>
        </Section>
      )}

      {(item.reason?.text || item.codes.length > 0) && (
        <Section title="Why">
          {item.reason?.text && <p className="text-[11px] text-zinc-600 leading-relaxed">{item.reason.text}</p>}
          {item.codes.length > 0 && (
            <p className="text-[11px] text-zinc-500 mt-1">
              Blocking: {item.codes.map(codeLabel).join(', ')}
            </p>
          )}
        </Section>
      )}

      {item.detailRows.length > 0 && (
        <Section title="Context">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {item.detailRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] text-zinc-500">{row.label}</span>
                <span className="text-[11px] font-semibold text-zinc-700 text-right">{row.value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {item.requestIds.length > 0 && (
        <p className="text-[10px] text-zinc-400 font-mono">
          Request {item.requestIds.map((id) => `#${String(id).slice(-6)}`).join(', ')}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">{title}</p>
      {children}
    </div>
  );
}