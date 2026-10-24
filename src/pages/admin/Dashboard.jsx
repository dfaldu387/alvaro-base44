import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Workflow, CalendarDays, MapPin, Send, Bell, MessageSquare, CheckCircle, History, ArrowRight, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { displayStage, formatDateShort } from '@/lib/reminderUtils';
import { cn } from '@/lib/utils';
import HeldBanner from '@/components/review/HeldBanner';
import AdminPage from '@/components/admin/ui/AdminPage';
import AdminCard from '@/components/admin/ui/AdminCard';
import AdminSection from '@/components/admin/ui/AdminSection';

const PAGE_SIZE = 500;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Monday-to-Sunday, matching how the week is spoken about everywhere else here.
function weekBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: dateKey(start), end: dateKey(end) };
}

const bookingDay = (r) => r.requested_date || String(r.updated_date || r.created_date || '').slice(0, 10);

export default function Dashboard() {
  const [clients, setClients] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  // Both reads are capped. Past the cap every number here is drawn from a slice
  // of the data, so the page says so rather than quietly under-reporting.
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    Promise.all([
      // Production metrics: test data is excluded server-side.
      base44.entities.ReminderClient.filter({ is_test: { $ne: true } }, '-created_date', PAGE_SIZE),
      base44.entities.BookingRequest.filter({ is_test: { $ne: true } }, '-created_date', PAGE_SIZE),
    ]).then(([c, r]) => {
      setClients(c || []);
      setRequests(r || []);
      setCapped((c || []).length >= PAGE_SIZE || (r || []).length >= PAGE_SIZE);
    }).finally(() => setLoading(false));
  }, []);

  const today = dateKey(new Date());
  const { start: weekStart, end: weekEnd } = useMemo(() => weekBounds(), []);

  const due = useMemo(() => clients.filter(c => displayStage(c) === 'needs_reminder'), [clients]);
  const waiting = useMemo(() => clients.filter(c => c.workflow_stage === 'waiting_on_response'), [clients]);
  const confirmedClients = useMemo(() => clients.filter(c => c.workflow_stage === 'confirmed'), [clients]);

  // Today's work, newest data already in hand — no extra request for this.
  const todaysStops = useMemo(() => requests
    .filter(r => bookingDay(r) === today && ['confirmed', 'completed'].includes(r.status))
    .sort((a, b) => (a.route_order ?? 999) - (b.route_order ?? 999)), [requests, today]);

  const completedAll = useMemo(() => requests.filter(r => r.status === 'completed'), [requests]);
  const completedWeek = useMemo(
    () => completedAll.filter(r => { const d = bookingDay(r); return d >= weekStart && d <= weekEnd; }),
    [completedAll, weekStart, weekEnd],
  );
  const revenueWeek = completedWeek.reduce((sum, r) => sum + (r.price || 0), 0);
  const recent = completedAll.slice(0, 5);

  // Each tile links to the screen where the number is acted on; a count you
  // cannot click is a number you have to go and find again.
  const cards = [
    { label: 'Due this week', value: due.length, to: '/admin/reminders', icon: Bell, tint: 'text-amber-600 bg-amber-50' },
    { label: 'Waiting for response', value: waiting.length, to: '/admin/reminders', icon: MessageSquare, tint: 'text-blue-600 bg-blue-50' },
    { label: 'Clients confirmed', value: confirmedClients.length, to: '/admin/reminders', icon: CheckCircle, tint: 'text-emerald-600 bg-emerald-50' },
    { label: 'Completed this week', value: completedWeek.length, to: '/admin/reports', icon: History, tint: 'text-indigo-600 bg-indigo-50' },
  ];

  const quick = [
    { label: 'Add Client', to: '/admin/clients', icon: UserPlus },
    { label: 'Reminders', to: '/admin/reminders', icon: Workflow },
    { label: "Today's Calendar", to: '/admin/schedule', icon: CalendarDays },
    { label: 'Open Route', to: '/admin/route', icon: MapPin },
    { label: 'Send Weekly Reminders', to: '/admin/reminders', icon: Send },
  ];

  const now = new Date();
  const todayLabel = `${DAY_NAMES[now.getDay()]} ${now.getDate()} ${now.toLocaleString('en-AU', { month: 'long' })}`;

  return (
    <AdminPage title="Dashboard" subtitle={todayLabel}>
      <HeldBanner />

      {capped && (
        <AdminCard className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            These figures are drawn from the most recent {PAGE_SIZE} records and are no longer the full picture.
            Use <Link to="/admin/reports" className="font-semibold underline">Reports</Link> for exact totals.
          </p>
        </AdminCard>
      )}

      {/* Today first. It is the question the app is opened to answer. */}
      <AdminSection
        title="Today"
        description={loading ? 'Loading…' : `${todaysStops.length} ${todaysStops.length === 1 ? 'appointment' : 'appointments'}`}
        actions={<Link to="/admin/route" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">Open route <ArrowRight className="w-3 h-3" /></Link>}
      >
        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : todaysStops.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-zinc-500">Nothing booked for today.</p>
            <Link to="/admin/schedule" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
              Open the calendar <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {todaysStops.map(r => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="w-16 shrink-0 text-sm font-semibold text-zinc-900">
                  {r.assigned_time || '—'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-800">{r.client_name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {(r.services || []).join(', ') || 'Service not set'}
                    {r.address_suburb ? ` · ${r.address_suburb}` : ''}
                  </span>
                </span>
                <span className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                  r.status === 'completed' ? 'bg-zinc-100 text-zinc-600' : 'bg-emerald-50 text-emerald-700',
                )}>
                  {r.status === 'completed' ? 'Done' : 'Confirmed'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <Link key={c.label} to={c.to} className="block rounded-xl transition-shadow hover:shadow-sm">
            <AdminCard className="h-full hover:border-zinc-300">
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', c.tint)}><c.icon className="w-5 h-5" /></div>
              <p className="text-2xl font-bold text-zinc-900">{loading ? '—' : c.value}</p>
              <p className="text-xs text-zinc-500">{c.label}</p>
            </AdminCard>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Who is waiting on you, by name — a count sends you looking, a list does not. */}
          <AdminSection
            title="Needs a reply"
            description="Clients due a reminder or waiting on an answer"
            actions={<Link to="/admin/reminders" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">Reminders <ArrowRight className="w-3 h-3" /></Link>}
          >
            {loading ? (
              <p className="text-sm text-zinc-400">Loading…</p>
            ) : due.length + waiting.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">Nobody is waiting. Nothing to chase.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {[...waiting.map(c => ({ c, kind: 'waiting' })), ...due.map(c => ({ c, kind: 'due' }))]
                  .slice(0, 6)
                  .map(({ c, kind }) => (
                    <li key={`${kind}-${c.id}`} className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-800">{c.client_name}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {c.usual_service || 'No usual service'}
                          {c.suburb ? ` · ${c.suburb}` : ''}
                        </span>
                      </span>
                      <span className={cn(
                        'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        kind === 'waiting' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700',
                      )}>
                        {kind === 'waiting' ? 'Waiting' : 'Due'}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            {due.length + waiting.length > 6 && (
              <p className="mt-3 text-xs text-zinc-400">
                and {due.length + waiting.length - 6} more
              </p>
            )}
          </AdminSection>

          <AdminSection title="Quick Actions" actions={<span className="text-xs text-zinc-400">{loading ? '—' : clients.length} clients</span>}>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 gap-2">
              {quick.map(q => (
                <Link key={q.label} to={q.to} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 min-h-[44px] hover:bg-zinc-50 text-sm text-zinc-700 font-medium">
                  <q.icon className="w-4 h-4 text-indigo-600 shrink-0" /> <span className="truncate">{q.label}</span>
                </Link>
              ))}
            </div>
          </AdminSection>
        </div>

        <AdminSection
          title="Completed"
          description="This week"
          actions={<span className="text-xs font-semibold text-emerald-600">${revenueWeek}</span>}
        >
          {recent.length === 0 ? <p className="text-xs text-zinc-400">No completed services yet.</p> : (
            <div className="space-y-2">
              {recent.map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="text-zinc-800 font-medium">{r.client_name}</p>
                    <p className="flex items-center gap-1 text-[11px] text-zinc-400">
                      <Clock className="w-3 h-3" /> {formatDateShort(bookingDay(r))}
                    </p>
                  </div>
                  <span className="text-zinc-600 font-semibold">${r.price || 0}</span>
                </div>
              ))}
              {/* The list is the latest five regardless of week; saying so stops
                  the $ figure above from looking like it belongs to these rows. */}
              <p className="pt-1 text-[11px] text-zinc-400">
                Latest {recent.length} of {completedAll.length} completed · {completedWeek.length} this week
              </p>
            </div>
          )}
          <Link to="/admin/reports" className="mt-3 inline-flex items-center gap-1 min-h-[44px] text-xs text-indigo-600 hover:text-indigo-700">View reports <ArrowRight className="w-3 h-3" /></Link>
        </AdminSection>
      </div>
    </AdminPage>
  );
}