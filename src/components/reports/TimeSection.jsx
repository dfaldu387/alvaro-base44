import React from 'react';
import AdminSection from '@/components/admin/ui/AdminSection';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import Figure from '@/components/reports/Figure';
import { fmtMins } from '@/lib/reports/reportCalc';

export default function TimeSection({ time, onDrill }) {
  const none = time.finalisedCount === 0;
  const why = 'No day in this range was finalised, so drive and idle time were never recorded.';
  const dayNote = 'Finalised days only. Days that were never finalised are left out, not counted as zero.';
  const avg = (k) => (time.perDay ? `${fmtMins(time.perDay[k])} per day` : undefined);
  const open = (title) => () => onDrill({ title, note: dayNote, rows: time.dayRows, empty: why });
  const nf = time.notFinalisedRows.length;
  return (
    <AdminSection title="Time and efficiency" description="How much of the working day is spent earning. Taken from finalised routes.">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Figure label="Cutting time" value={none ? null : fmtMins(time.cut)} reason={why} sub={avg('cut')} onClick={open('Cutting time by day')} />
        <Figure label="Drive time" value={none ? null : fmtMins(time.drive)} reason={why} sub={avg('drive')} onClick={open('Drive time by day')} />
        <Figure label="Idle time" value={none ? null : fmtMins(time.idle)} reason={why} sub={avg('idle')} onClick={open('Idle time by day')} />
        <Figure label="Time spent earning" value={time.ratio == null ? null : `${Math.round(time.ratio * 100)}%`}
          reason={why} sub="Cutting ÷ (cutting + driving + idle)" onClick={open('Earning time by day')} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <StatusBadge tone="success">{time.finalisedCount} finalised day{time.finalisedCount === 1 ? '' : 's'}</StatusBadge>
        <button className="max-sm:min-h-11" onClick={() => onDrill({ title: 'Days not finalised', note: 'Excluded from every time figure above.', rows: time.notFinalisedRows, empty: 'Every working day in this range was finalised.' })}>
          <StatusBadge tone={nf ? 'warning' : 'neutral'} className="cursor-pointer">{nf} not finalised</StatusBadge>
        </button>
        {nf > 0 && <span>These days have bookings but no finalised route, so they are not counted as zero.</span>}
      </div>
    </AdminSection>
  );
}