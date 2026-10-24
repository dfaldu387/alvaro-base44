import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AdminSection from '@/components/admin/ui/AdminSection';
import Figure from '@/components/reports/Figure';
import { fmtMoney } from '@/lib/reports/reportCalc';

export default function MoneySection({ money, time, onDrill }) {
  const noBookings = money.bookingsCount === 0;
  const noPrice = 'No completed bookings in this range have a price or payment recorded.';
  const noHours = time.finalisedCount === 0
    ? 'No day in this range was finalised, so working hours are unknown.'
    : 'No completed booking falls on a finalised day.';
  return (
    <AdminSection title="Money" description="Completed bookings only. Uses the payment received where one exists, otherwise the booking price.">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Figure label="Revenue" value={money.revenue.value == null ? null : fmtMoney(money.revenue.value)}
          reason={noBookings ? 'No completed bookings in this range.' : noPrice}
          sub={`${money.revenue.rows.length} completed booking${money.revenue.rows.length === 1 ? '' : 's'}`}
          onClick={() => onDrill({ title: 'Revenue', note: 'Every completed booking counted in revenue.', rows: money.revenue.rows })} />
        <Figure label="Average price per booking" value={money.avgPrice == null ? null : fmtMoney(money.avgPrice)}
          reason={noBookings ? 'No completed bookings in this range.' : noPrice}
          onClick={() => onDrill({ title: 'Average price', note: 'Revenue divided by these bookings.', rows: money.revenue.rows })} />
        <Figure label="Revenue per working hour" value={money.revPerHour.value == null ? null : fmtMoney(money.revPerHour.value)}
          reason={noHours} sub={`${money.revPerHour.basis} booking${money.revPerHour.basis === 1 ? '' : 's'} on finalised days`}
          onClick={() => onDrill({ title: 'Working hours behind this figure', note: 'Finalised days only: cutting + driving + idle time.', rows: money.revPerHour.rows, empty: noHours })} />
      </div>
      {money.unpricedRows.length > 0 && (
        <button onClick={() => onDrill({ title: 'Completed without a price', note: 'Not included in revenue or the average.', rows: money.unpricedRows })}
          className="text-xs text-amber-700 hover:underline mb-3 block">
          {money.unpricedRows.length} completed booking{money.unpricedRows.length === 1 ? ' has' : 's have'} no price and {money.unpricedRows.length === 1 ? 'is' : 'are'} left out. View
        </button>
      )}
      {money.trend.length === 0 ? <p className="text-sm text-zinc-400">No revenue to chart in this range.</p> : (
        <>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={money.trend} margin={{ left: -10, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmtMoney(v)} />
                <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]}
                  cursor="pointer" onClick={(d) => onDrill({ title: `Revenue · ${d.label}`, rows: d.rows })} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 divide-y divide-zinc-100">
            {money.trend.map((t) => (
              <button key={t.key} onClick={() => onDrill({ title: `Revenue · ${t.label}`, rows: t.rows })}
                className="w-full grid grid-cols-4 gap-2 py-2 text-xs text-left hover:bg-zinc-50">
                <span className="font-medium text-zinc-800">{t.label}</span>
                <span className="text-zinc-600">{fmtMoney(t.revenue)}</span>
                <span className="text-zinc-600">avg {fmtMoney(t.avg)}</span>
                <span className="text-zinc-600">{t.perHour == null ? 'per hr: n/a' : `${fmtMoney(t.perHour)}/hr`}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </AdminSection>
  );
}