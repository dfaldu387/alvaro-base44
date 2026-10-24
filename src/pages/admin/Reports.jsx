import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, RefreshCw, Star, UserX, Heart, ChevronRight, CalendarClock, XCircle, Calendar } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';
import { subDays, startOfDay, isWithinInterval, parseISO } from 'date-fns';
import { clientStatus, availabilityTypeDisplay } from '@/lib/clientStatus';
import AdminPage from '@/components/admin/ui/AdminPage';
import BusinessReports from '@/components/reports/BusinessReports';

const RANGES = [
  { key: 'week', label: 'Week', days: 7 },
  { key: 'month', label: 'Month', days: 30 },
  { key: '6months', label: '6 Months', days: 180 },
  { key: 'year', label: 'Year', days: 365 },
  { key: 'custom', label: 'Custom' },
];

const FREQ_INTERVAL = { 'Weekly': 7, 'Fortnightly': 14, 'Every 3 weeks': 21, 'Monthly': 30 };
const norm = (s) => (s || '').toLowerCase().trim();
const vDate = (b) => { const v = b.updated_date || b.created_date; return v ? new Date(v) : null; };

export default function Reports() {
  const navigate = useNavigate();
  const [range, setRange] = useState('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [clients, setClients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      // Production reporting: test data is excluded server-side.
      base44.entities.ReminderClient.filter({ is_test: { $ne: true } }, '-created_date', 500),
      base44.entities.BookingRequest.filter({ is_test: { $ne: true } }, '-created_date', 500),
    ]).then(([c, b]) => { setClients(c); setBookings(b); }).finally(() => setLoading(false));
  }, []);

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (range === 'custom') {
      return {
        from: customFrom ? startOfDay(parseISO(customFrom)) : subDays(now, 7),
        to: customTo ? new Date(customTo + 'T23:59:59') : now,
      };
    }
    const r = RANGES.find(r => r.key === range);
    return { from: startOfDay(subDays(now, r.days)), to: now };
  }, [range, customFrom, customTo]);

  const periodLabel = range === 'week' ? 'This week' : range === 'month' ? 'This month' : range === '6months' ? 'Past 6 months' : range === 'year' ? 'This year' : 'Custom range';

  const data = useMemo(() => {
    const inPeriod = (d) => d && isWithinInterval(d, { start: from, end: to });
    const completedByName = {};
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const n = norm(b.client_name); if (!n) return;
      (completedByName[n] = completedByName[n] || []).push(b);
    });
    const sortDates = (arr) => arr.map(vDate).filter(Boolean).sort((a, b) => a - b);
    const active = clients.filter(c => !c.archived);
    const total = active.length;

    let newCount = 0; const newSet = new Set();
    let returningCount = 0;
    active.forEach(c => {
      const dates = sortDates(completedByName[norm(c.client_name)] || []);
      if (!dates.length) return;
      if (inPeriod(dates[0])) { newCount++; newSet.add(c.id); }
      if (dates.some(d => inPeriod(d)) && dates.some(d => d < from)) returningCount++;
    });

    const regularCount = active.filter(c => c.recurring_enabled).length;
    let inactiveCount = 0;
    active.forEach(c => {
      const comp = (completedByName[norm(c.client_name)] || []).filter(b => b.status === 'completed');
      if (clientStatus(c, comp) === 'Inactive') inactiveCount++;
    });

    const periodBookings = bookings.filter(b => inPeriod(vDate(b)));
    const totalBookings = periodBookings.length;
    const outcomes = [
      { label: 'Serviced', count: periodBookings.filter(b => b.status === 'completed').length },
      { label: 'Rescheduled', count: periodBookings.filter(b => b.status === 'rescheduled').length },
      { label: 'Cancelled', count: periodBookings.filter(b => b.status === 'declined').length },
      { label: 'No-show', count: periodBookings.filter(b => b.status === 'no_show').length },
      { label: 'Could not fit', count: periodBookings.filter(b => b.status === 'could_not_fit').length },
    ];

    let expected = 0, returned = 0;
    active.forEach(c => {
      const comp = (completedByName[norm(c.client_name)] || []).filter(b => b.status === 'completed');
      const dates = sortDates(comp);
      if (!dates.length) return;
      const last = dates[dates.length - 1];
      const f = c.recurring_enabled ? (c.recurring_frequency || c.frequency) : c.frequency;
      const interval = FREQ_INTERVAL[f] || (c.recurring_enabled ? 30 : null);
      if (!interval) return;
      const expectedDate = new Date(last.getTime() + interval * 86400000);
      if (inPeriod(expectedDate)) {
        expected++;
        if (dates.some(d => d > last)) returned++;
      }
    });
    const retentionRate = expected ? Math.round(returned / expected * 100) : 0;
    const newWithSecond = [...newSet].filter(id => {
      const c = active.find(c => c.id === id);
      const comp = (completedByName[norm(c && c.client_name)] || []).filter(b => b.status === 'completed');
      return comp.length >= 2;
    }).length;
    const secondRate = newCount ? Math.round(newWithSecond / newCount * 100) : 0;

    const freqBuckets = { 'Weekly': 0, 'Fortnightly': 0, 'Every 3 Weeks': 0, 'Monthly': 0, 'Non-recurring': 0 };
    const availBuckets = { 'Fixed Time': 0, 'Fixed Window': 0, 'Flexible': 0, 'Not Configured': 0 };
    active.forEach(c => {
      const f = c.recurring_enabled ? (c.recurring_frequency || c.frequency) : c.frequency;
      const fLabel = f === 'Weekly' ? 'Weekly' : f === 'Fortnightly' ? 'Fortnightly' : f === 'Every 3 weeks' ? 'Every 3 Weeks' : f === 'Monthly' ? 'Monthly' : 'Non-recurring';
      freqBuckets[fLabel] = (freqBuckets[fLabel] || 0) + 1;
      availBuckets[availabilityTypeDisplay(c)] = (availBuckets[availabilityTypeDisplay(c)] || 0) + 1;
    });

    const newAdded = active.filter(c => { const d = c.created_date ? new Date(c.created_date) : null; return d && inPeriod(d); }).length;
    let reactivated = 0;
    active.forEach(c => {
      const dates = sortDates((completedByName[norm(c.client_name)] || []).filter(b => b.status === 'completed'));
      const inVis = dates.find(d => inPeriod(d));
      if (!inVis) return;
      const prior = dates.filter(d => d < inVis);
      if (!prior.length) return;
      if ((inVis - prior[prior.length - 1]) / 86400000 > 60) reactivated++;
    });

    return {
      total, newCount, returningCount, regularCount, inactiveCount,
      outcomes, totalBookings,
      expected, returned, retentionRate, secondRate,
      freqBuckets, availBuckets,
      newAdded, reactivated,
      rescheduledCount: outcomes[1].count, cancelledCount: outcomes[2].count,
    };
  }, [clients, bookings, from, to]);

  const pct = (n) => data.total ? Math.round(n / data.total * 100) : 0;
  const retentionStatus = data.retentionRate >= 60 ? { label: 'Good', cls: 'bg-violet-50 text-violet-700' }
    : data.retentionRate >= 40 ? { label: 'Improving', cls: 'bg-amber-50 text-amber-700' }
    : { label: 'Needs attention', cls: 'bg-red-50 text-red-700' };

  const summaryCards = [
    { label: 'New clients', value: data.newCount, sub: `${pct(data.newCount)}% of total`, icon: UserPlus, tint: 'text-indigo-600 bg-indigo-50', to: '/admin/clients' },
    { label: 'Returning clients', value: data.returningCount, sub: `${pct(data.returningCount)}% of total`, icon: RefreshCw, tint: 'text-emerald-600 bg-emerald-50', to: '/admin/clients' },
    { label: 'Regular clients', value: data.regularCount, sub: `${pct(data.regularCount)}% of total`, icon: Star, tint: 'text-violet-600 bg-violet-50', to: '/admin/clients?group=recurring' },
    { label: 'Inactive clients', value: data.inactiveCount, sub: `${pct(data.inactiveCount)}% of total`, icon: UserX, tint: 'text-orange-600 bg-orange-50', to: '/admin/clients?group=inactive' },
  ];

  return (
    <AdminPage title="Reports" subtitle="Money, time, routes and clients" actions={
        <>
          <div className="inline-flex rounded-full bg-zinc-100 p-0.5">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={cn('px-3 h-8 max-sm:h-11 rounded-full text-xs font-medium transition-colors', range === r.key ? 'bg-violet-100 text-violet-700' : 'text-zinc-500 hover:text-zinc-700')}>
                {r.label}
              </button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-xs rounded-md border border-zinc-200 px-2 text-zinc-700" />
              <span className="text-zinc-400 text-xs">to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-xs rounded-md border border-zinc-200 px-2 text-zinc-700" />
            </div>
          )}
        </>
      }>
      <BusinessReports from={from} to={to} />
      <h2 className="text-lg font-semibold text-zinc-900 pt-2">Client insights</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {summaryCards.map(c => (
          <button key={c.label} onClick={() => navigate(c.to)} className="text-left bg-white border border-zinc-200 rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition-all">
            <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-2.5', c.tint)}><c.icon className="w-5 h-5" /></div>
            <p className="text-2xl font-bold text-zinc-900">{loading ? '—' : c.value}</p>
            <p className="text-[13px] font-medium text-zinc-700">{c.label}</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">{c.sub}</p>
          </button>
        ))}
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 text-rose-600 bg-rose-50"><Heart className="w-5 h-5" /></div>
          <p className="text-2xl font-bold text-zinc-900">{loading ? '—' : `${data.retentionRate}%`}</p>
          <p className="text-[13px] font-medium text-zinc-700">Retention</p>
          <span className={cn('inline-flex mt-1 px-2 py-0.5 rounded-md text-[11px] font-medium', retentionStatus.cls)}>{retentionStatus.label}</span>
        </div>
      </div>

      {/* Outcomes + Retention */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="font-semibold text-zinc-900 mb-4">Booking outcomes</h2>
          {loading ? <Skeleton /> : data.totalBookings === 0 ? <p className="text-sm text-zinc-400">No booking requests in this period.</p> : (
            <div className="space-y-3">
              {data.outcomes.map(o => {
                const p = data.totalBookings ? Math.round(o.count / data.totalBookings * 100) : 0;
                return (
                  <div key={o.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-700">{o.label}</span>
                      <span className="text-zinc-500">{p}% · {o.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${p}%` }} /></div>
                  </div>
                );
              })}
              <div className="pt-3 mt-2 border-t border-zinc-100 flex justify-between text-sm">
                <span className="text-zinc-500">Total bookings</span>
                <span className="font-semibold text-zinc-900">{data.totalBookings}</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="font-semibold text-zinc-900 mb-4">Client retention</h2>
          {loading ? <Skeleton /> : (
            <div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Stat label="Expected to return" value={data.expected} />
                <Stat label="Returned" value={data.returned} />
              </div>
              <div className="rounded-lg bg-violet-50 p-4 text-center mb-3">
                <p className="text-3xl font-bold text-violet-700">{data.retentionRate}%</p>
                <p className="text-xs text-violet-600 mt-0.5">Retention rate</p>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Second visit return rate</span>
                <span className="font-semibold text-zinc-900">{data.secondRate}%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Breakdown + Movement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="font-semibold text-zinc-900 mb-4">Client breakdown</h2>
          {loading ? <Skeleton /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Breakdown title="Frequency" buckets={data.freqBuckets} total={data.total} />
              <Breakdown title="Availability" buckets={data.availBuckets} total={data.total} />
            </div>
          )}
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="font-semibold text-zinc-900 mb-4">Recent client movement</h2>
          {loading ? <Skeleton /> : (
            <div className="divide-y divide-zinc-100">
              <Movement icon={UserPlus} tint="text-indigo-600 bg-indigo-50" label="New clients added" count={data.newAdded} period={periodLabel} to="/admin/clients" />
              <Movement icon={RefreshCw} tint="text-emerald-600 bg-emerald-50" label="Clients reactivated" count={data.reactivated} period={periodLabel} to="/admin/clients?group=active" />
              <Movement icon={CalendarClock} tint="text-amber-600 bg-amber-50" label="Bookings rescheduled" count={data.rescheduledCount} period={periodLabel} to="/admin/requests" />
              <Movement icon={XCircle} tint="text-red-600 bg-red-50" label="Bookings cancelled" count={data.cancelledCount} period={periodLabel} to="/admin/requests" />
            </div>
          )}
        </div>
      </div>
    </AdminPage>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <p className="text-xl font-bold text-zinc-900">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function Breakdown({ title, buckets, total }) {
  const entries = Object.entries(buckets);
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-2.5">
        {entries.map(([label, n]) => {
          const p = total ? Math.round(n / total * 100) : 0;
          return (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-600">{label}</span>
                <span className="text-zinc-400">{p}% · {n}</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${p}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Movement({ icon: Icon, tint, label, count, period, to }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(to)} className="w-full flex items-center gap-3 py-3 hover:bg-zinc-50 -mx-2 px-2 rounded-lg transition-colors">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', tint)}><Icon className="w-4.5 h-4.5" /></div>
      <div className="flex-1 text-left">
        <p className="text-sm font-medium text-zinc-800">{label}</p>
        <p className="text-[11px] text-zinc-400">{period}</p>
      </div>
      <span className="text-lg font-bold text-zinc-900">{count}</span>
      <ChevronRight className="w-4 h-4 text-zinc-300" />
    </button>
  );
}

function Skeleton() {
  return <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-4 rounded bg-zinc-100 animate-pulse" />)}</div>;
}