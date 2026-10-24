import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell, MessageSquare, Clock, CheckCircle, Send, Check, Search, Filter,
  Send as SendIcon, History, Pencil, MoreHorizontal, X, Lightbulb,
  MessageCircle, CalendarPlus, AlertCircle, CalendarDays, BellRing,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createAdminBooking } from '@/lib/adminBookingApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ClientDrawer from '@/components/clients/ClientDrawer';
import ChatPanel from '@/components/workflow/ChatPanel';
import WeekViewTab, { WeekNav } from '@/components/workflow/WeekViewTab';
import WeekClientDrawer from '@/components/workflow/WeekClientDrawer';
import {
  STAGES, STAGE_META, availabilityStart, availabilityEnd, confirmedDayOfWeek,
  CATEGORY_OPTIONS, DAY_ORDER, DAY_OPTIONS, DEFAULT_MESSAGE, DEFAULT_FOLLOWUP,
  SOURCE_OPTIONS, CLIENT_TYPE_OPTIONS, CLIENT_TYPE_STYLES,
  CONFIRMATION_STATUS_OPTIONS, CONFIRMATION_STATUS_LABEL, CONFIRMATION_STATUS_STYLES,
  TIME_RECEIVED_STATUS_LABEL, TIME_RECEIVED_STATUS_STYLES,
  FREQUENCY_OPTIONS, FREQUENCY_STYLES, CATEGORY_STYLES,
  formatDateShort, formatDueDate, followUpDueDate, initials,
  stageForWeek, currentWeekId, weekStart, weekStartISO,
} from '@/lib/reminderUtils';
import { cn } from '@/lib/utils';

// One rule for the date: the server resolves the winning cadence, exactly as when a visit is completed.
const advanceDate = async (clientId) => (await base44.functions.invoke('reminderAdvanceDate', { client_id: clientId })).data?.date || null;

const COLUMN_TINT = {
  needs_reminder: { bar: 'bg-orange-400', head: 'text-orange-700', bg: 'bg-orange-50/50', chip: 'bg-orange-100 text-orange-700', btn: 'border-orange-300 text-orange-700 hover:bg-orange-50' },
  waiting_on_response: { bar: 'bg-blue-400', head: 'text-blue-700', bg: 'bg-blue-50/50', chip: 'bg-blue-100 text-blue-700', btn: 'border-blue-300 text-blue-700 hover:bg-blue-50' },
  time_received: { bar: 'bg-yellow-400', head: 'text-yellow-700', bg: 'bg-yellow-50/50', chip: 'bg-yellow-100 text-yellow-700', btn: 'border-yellow-300 text-yellow-700 hover:bg-yellow-50' },
  confirmed: { bar: 'bg-emerald-400', head: 'text-emerald-700', bg: 'bg-emerald-50/50', chip: 'bg-emerald-100 text-emerald-700', btn: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' },
};
const STAGE_ICON = { needs_reminder: Bell, waiting_on_response: MessageSquare, time_received: Clock, confirmed: CheckCircle };
const STAGE_LABEL = { needs_reminder: 'Needs Reminder', waiting_on_response: 'Waiting on Client', time_received: 'Time Received', confirmed: 'Confirmed' };
const WEEK_OPTIONS = [
  { key: 'this_week', label: 'This Week' },
  { key: 'next_week', label: 'Next Week' },
  { key: 'week_after', label: 'Week After' },
];
const GROUP_DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', '__none__'];

export default function ClientWorkflow() {
  const [clients, setClients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekMode, setWeekMode] = useState('this_week');
  const [search, setSearch] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [filters, setFilters] = useState({ stage: '', frequency: '', category: '', client_type: '', preferred_day: '', service: '', suburb: '', confirmation_status: '' });
  const [menuFor, setMenuFor] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState([]);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [editFor, setEditFor] = useState(null);
  const [chatFor, setChatFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [datePickFor, setDatePickFor] = useState(null);
  const [dateValue, setDateValue] = useState('');
  const [confirmRemoveFor, setConfirmRemoveFor] = useState(null);
  const [viewMode, setViewMode] = useState('pipeline');
  const [weekClient, setWeekClient] = useState(null);
  const noticeTimer = useRef(null);
  const addTokens = useRef({});
  const navigate = useNavigate();

  const flash = useCallback((msg, kind = 'ok') => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ msg, kind });
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const dismissNotice = () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); setNotice(null); };
  // An action that returns a string says its own success message, so it can add
  // something the caller could not know in advance (a day that turned out to be full).
  const run = useCallback(async (fn, okMsg, errMsg) => {
    try {
      setBusy(true);
      const said = await fn();
      const msg = typeof said === 'string' && said ? said : okMsg;
      if (msg) flash(msg);
    }
    catch (e) { flash(errMsg || 'Something went wrong. Please try again.', 'error'); }
    finally { setBusy(false); }
  }, [flash]);

  const load = () => {
    setLoading(true);
    Promise.all([
      // Reminder workflow: test clients never enter reminder, rebooking or
      // follow-up campaigns.
      base44.entities.ReminderClient.filter({ is_test: { $ne: true } }, '-created_date', 500),
      base44.entities.BookingRequest.list('-created_date', 500),
    ]).then(([c, r]) => { setClients(c); setBookings(r); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const suburbs = useMemo(() => [...new Set(clients.map(c => c.suburb).filter(Boolean))].sort(), [clients]);
  const services = useMemo(() => [...new Set(clients.map(c => c.usual_service).filter(Boolean))].sort(), [clients]);

  const inPipeline = useMemo(() => {
    let list = clients.map(c => ({ ...c, _stage: stageForWeek(c, weekMode) })).filter(c => c._stage);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(c => [c.client_name, c.usual_service, c.suburb].some(v => (v || '').toLowerCase().includes(q)));
    if (filters.frequency) list = list.filter(c => c.frequency === filters.frequency);
    if (filters.category) list = list.filter(c => c.scheduling_category === filters.category);
    if (filters.client_type) list = list.filter(c => (c.client_type || 'New') === filters.client_type);
    if (filters.preferred_day) list = list.filter(c => (c.preferred_day || c.received_day) === filters.preferred_day);
    if (filters.service) list = list.filter(c => c.usual_service === filters.service);
    if (filters.suburb) list = list.filter(c => c.suburb === filters.suburb);
    if (filters.stage) list = list.filter(c => c._stage === filters.stage);
    if (filters.confirmation_status) list = list.filter(c => (c.confirmation_status || 'waiting_confirmation') === filters.confirmation_status);
    return list;
  }, [clients, weekMode, search, filters]);

  const columns = useMemo(() => {
    const g = { needs_reminder: [], waiting_on_response: [], time_received: [], confirmed: [] };
    for (const c of inPipeline) g[c._stage]?.push(c);
    const today = new Date().toISOString().slice(0, 10);
    g.needs_reminder.sort((a, b) => {
      const ao = (a.next_reminder_date || '9999') < today ? 0 : 1;
      const bo = (b.next_reminder_date || '9999') < today ? 0 : 1;
      return ao - bo || (a.next_reminder_date || '').localeCompare(b.next_reminder_date || '') || a.client_name.localeCompare(b.client_name);
    });
    g.waiting_on_response.sort((a, b) => {
      const aDue = followUpDueDate(a.reminder_sent_date) || '9999';
      const bDue = followUpDueDate(b.reminder_sent_date) || '9999';
      const ao = aDue < today ? 0 : 1, bo = bDue < today ? 0 : 1;
      return ao - bo || aDue.localeCompare(bDue) || (a.reminder_sent_date || '').localeCompare(b.reminder_sent_date || '') || a.client_name.localeCompare(b.client_name);
    });
    g.time_received.sort((a, b) => availabilityStart(a.availability_window) - availabilityStart(b.availability_window) || availabilityEnd(b.availability_window) - availabilityEnd(a.availability_window) || a.client_name.localeCompare(b.client_name));
    g.confirmed.sort((a, b) => (a.confirmed_date || '').localeCompare(b.confirmed_date || '') || availabilityStart(a.confirmed_time) - availabilityStart(b.confirmed_time));
    return g;
  }, [inPipeline]);

  const counts = { needs_reminder: columns.needs_reminder.length, waiting_on_response: columns.waiting_on_response.length, time_received: columns.time_received.length, confirmed: columns.confirmed.length };

  const setStage = (client, stage, extra = {}) => run(async () => {
    const patch = { workflow_stage: stage, workflow_updated_date: new Date().toISOString(), ...extra };
    if (stage === 'confirmed') {
      if (!patch.confirmed_date) patch.confirmed_date = new Date().toISOString().slice(0, 10);
      if (!patch.confirmation_status) patch.confirmation_status = 'waiting_confirmation';
    }
    if (stage === 'time_received' && !patch.time_received_status) patch.time_received_status = 'waiting';
    await base44.entities.ReminderClient.update(client.id, patch);
    await load();
  }, `Moved to ${STAGE_LABEL[stage]}`, 'Could not move client. Please try again.');

  const markClientConfirmed = (client) => run(async () => {
    await base44.entities.ReminderClient.update(client.id, { confirmation_status: 'client_confirmed', workflow_updated_date: new Date().toISOString() });
    await load();
  }, 'Client confirmed', 'Could not update confirmation. Please try again.');

  const addToCalendar = (client) => run(async () => {
    const weekOf = currentWeekId(weekMode === 'this_week' ? 0 : weekMode === 'next_week' ? 1 : 2);
    const day = client.received_day || client.preferred_day || 'Flexible';
    const dup = bookings.find(b => b.client_name === client.client_name && b.week_of === weekOf && b.day === day && b.status === 'pending');
    if (dup) { flash('Already added to Schedule'); return; }
    // One token per client/week/day, kept until the save succeeds: a retry after a lost
    // response returns the same booking; once added, the next cycle gets a new one.
    const tokenKey = `${client.id}|${weekOf}|${day}`;
    const token = (addTokens.current[tokenKey] ||= (globalThis.crypto?.randomUUID?.() || `wf-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    // The booking is saved either way; a full day is reported, never a refusal.
    let fullDay = '';
    await createAdminBooking(token, {
      client_id: client.id,
      client_name: client.client_name, phone: client.phone, email: client.email,
      address: client.suburb || client.address, address_suburb: client.suburb, day,
      availability_window: client.availability_window,
      service_items: client.usual_service ? [{ name: client.usual_service, qty: 1 }] : [],
      week_of: weekOf, notes: client.weekly_note || '',
    }, { onCapacity: (reason) => { fullDay = reason; } });
    delete addTokens.current[tokenKey];
    await base44.entities.ReminderClient.update(client.id, { time_received_status: 'added_to_schedule', workflow_updated_date: new Date().toISOString() });
    await load();
    return fullDay ? `Added to Schedule. ${fullDay}` : '';
  }, 'Added to Schedule', 'Could not add to Schedule. Please try again.');

  const openSchedule = (client) => {
    const day = client.received_day || client.preferred_day || 'Flexible';
    navigate(`/admin/schedule?day=${encodeURIComponent(day)}&client=${encodeURIComponent(client.client_name)}`);
  };

  const sendReminder = (client) => run(async () => {
    await base44.entities.ReminderClient.update(client.id, {
      workflow_stage: 'waiting_on_response', reminder_sent_date: new Date().toISOString(),
      follow_up_due_date: followUpDueDate(new Date().toISOString()), workflow_updated_date: new Date().toISOString(),
    });
    await load();
  }, 'Reminder prepared', 'Reminder could not be prepared. Please try again.');

  const sendFollowUp = (client) => run(async () => {
    await base44.entities.ReminderClient.update(client.id, {
      follow_up_sent_date: new Date().toISOString(), workflow_updated_date: new Date().toISOString(),
    });
    await load();
  }, 'Follow-up prepared', 'Follow-up could not be prepared. Please try again.');

  const sendAppointmentCheck = (client) => run(async () => {
    await base44.entities.ReminderClient.update(client.id, { appointment_check_sent_date: new Date().toISOString(), workflow_updated_date: new Date().toISOString() });
    await load();
  }, 'Appointment check prepared', 'Could not prepare appointment check. Please try again.');

  const markReplied = (client) => setStage(client, 'time_received', { received_day: client.received_day || (client.preferred_day && DAY_ORDER.includes(client.preferred_day) ? client.preferred_day : 'Flexible') });

  const notInterested = (client) => run(async () => {
    const next = await advanceDate(client.id);
    await base44.entities.ReminderClient.update(client.id, { workflow_stage: 'none', workflow_updated_date: new Date().toISOString(), ...(next ? { next_reminder_date: next } : {}) });
    await load();
  }, 'Removed from this week', 'Could not remove client. Please try again.');

  const moveReminderToWeek = (client, offset, label) => run(async () => {
    await base44.entities.ReminderClient.update(client.id, { next_reminder_date: weekStartISO(offset), workflow_stage: 'none', workflow_updated_date: new Date().toISOString() });
    await load();
  }, `Moved to ${label}`, 'Could not move reminder. Please try again.');

  const moveReminder3Weeks = (client) => run(async () => {
    await base44.entities.ReminderClient.update(client.id, { next_reminder_date: weekStartISO(3), workflow_stage: 'none', workflow_updated_date: new Date().toISOString() });
    await load();
  }, 'Moved 3 Weeks Ahead', 'Could not move reminder. Please try again.');

  const openChooseDate = (client) => { setDatePickFor(client); setDateValue(weekStartISO(1)); setMenuFor(null); };

  const applyChooseDate = () => run(async () => {
    if (!dateValue || !datePickFor) return;
    await base44.entities.ReminderClient.update(datePickFor.id, { next_reminder_date: dateValue, workflow_stage: 'none', workflow_updated_date: new Date().toISOString() });
    const d = new Date(dateValue + 'T00:00:00');
    if (d >= weekStart(0) && d < weekStart(1)) setWeekMode('this_week');
    else if (d >= weekStart(1) && d < weekStart(2)) setWeekMode('next_week');
    else if (d >= weekStart(2) && d < weekStart(3)) setWeekMode('week_after');
    setDatePickFor(null);
    await load();
  }, `Moved to ${formatDueDate(dateValue)}`, 'Could not move reminder. Please try again.');

  const pauseReminders = (client) => run(async () => {
    await base44.entities.ReminderClient.update(client.id, { is_paused: true, workflow_stage: 'none', workflow_updated_date: new Date().toISOString() });
    await load();
  }, 'Reminders paused', 'Could not pause reminders. Please try again.');

  const skipCycle = (client) => run(async () => {
    const next = (await advanceDate(client.id)) || weekStartISO(1);
    await base44.entities.ReminderClient.update(client.id, { next_reminder_date: next, workflow_stage: 'none', workflow_updated_date: new Date().toISOString() });
    await load();
  }, 'Skipped this cycle', 'Could not skip cycle. Please try again.');

  const removeFromThisWeek = (client) => run(async () => {
    const next = (await advanceDate(client.id)) || weekStartISO(1);
    await base44.entities.ReminderClient.update(client.id, { next_reminder_date: next, workflow_stage: 'none', workflow_updated_date: new Date().toISOString() });
    await load();
  }, 'Removed from this week', 'Could not remove client. Please try again.');

  const onDragEnd = (res) => {
    if (!res.destination || res.destination.droppableId === res.source.droppableId) return;
    const client = inPipeline.find(c => c.id === res.draggableId);
    if (client) setStage(client, res.destination.droppableId);
  };

  const openReview = () => {
    setReviewDrafts(columns.needs_reminder.map(c => ({ id: c.id, client_name: c.client_name, message: c.reminder_message || DEFAULT_MESSAGE })));
    setReviewOpen(true);
  };

  const sendBatch = () => run(async () => {
    const now = new Date().toISOString();
    await base44.entities.ReminderClient.bulkUpdate(reviewDrafts.map(d => ({ id: d.id, workflow_stage: 'waiting_on_response', reminder_message: d.message, reminder_sent_date: now, follow_up_due_date: followUpDueDate(now), workflow_updated_date: now })));
    setReviewOpen(false);
    await load();
  }, `${reviewDrafts.length} reminders prepared`, 'Reminders could not be prepared. Please try again.');

  const completed = bookings.filter(b => b.status === 'completed').sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6 pt-4 space-y-3">
      {/* Toolbar: the two views of this week, then the actions that belong to the one shown. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="flex w-fit gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm">
              <button onClick={() => setViewMode('pipeline')} className={cn('px-3 py-1.5 max-sm:min-h-11 text-sm font-medium rounded-lg transition-colors', viewMode === 'pipeline' ? 'bg-[#6366F1] text-white' : 'text-zinc-600 hover:bg-zinc-100')}>Pipeline</button>
              <button onClick={() => setViewMode('week')} className={cn('px-3 py-1.5 max-sm:min-h-11 text-sm font-medium rounded-lg transition-colors', viewMode === 'week' ? 'bg-[#6366F1] text-white' : 'text-zinc-600 hover:bg-zinc-100')}>Week View</button>
            </div>
          </div>
          {viewMode === 'pipeline' ? (
            <div className="flex items-center justify-center lg:justify-center order-first lg:order-none">
              <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm">
                {WEEK_OPTIONS.map(w => (
                  <button key={w.key} onClick={() => setWeekMode(w.key)}
                    className={cn('px-3 sm:px-4 py-1.5 max-sm:min-h-11 text-xs sm:text-sm font-medium rounded-md transition-colors',
                      weekMode === w.key ? 'bg-[#6366F1] text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50')}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <WeekNav weekMode={weekMode} setWeekMode={setWeekMode} />
          )}
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {viewMode === 'pipeline' && <Button onClick={openReview} className="bg-[#6366F1] hover:bg-[#5457e6] text-white h-9 max-sm:h-11"><SendIcon className="w-4 h-4" /> Weekly Reminders</Button>}
            {viewMode === 'pipeline' && <Button variant="outline" className="bg-white border-zinc-200 text-zinc-700 h-9 max-sm:h-11" onClick={() => setCompletedOpen(true)}><History className="w-4 h-4" /> Completed</Button>}
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..." className="pl-8 w-full sm:w-56 bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 h-9 max-sm:h-11" />
            </div>
            <Button variant="outline" className="bg-white border-zinc-200 text-zinc-700 h-9 max-sm:h-11" onClick={() => setShowFilter(v => !v)}><Filter className="w-4 h-4" /> Filters</Button>
          </div>
        </div>

        {showFilter && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 p-3 rounded-xl border border-zinc-200 bg-zinc-50">
            <FilterSelect value={filters.stage} onChange={v => setFilters(f => ({ ...f, stage: v }))} placeholder="All Stages" options={STAGES.map(s => STAGE_LABEL[s])} values={STAGES} />
            <FilterSelect value={filters.frequency} onChange={v => setFilters(f => ({ ...f, frequency: v }))} placeholder="All Frequencies" options={FREQUENCY_OPTIONS} />
            <FilterSelect value={filters.category} onChange={v => setFilters(f => ({ ...f, category: v }))} placeholder="All Availability Types" options={CATEGORY_OPTIONS} />
            <FilterSelect value={filters.client_type} onChange={v => setFilters(f => ({ ...f, client_type: v }))} placeholder="All Client Types" options={CLIENT_TYPE_OPTIONS} />
            <FilterSelect value={filters.preferred_day} onChange={v => setFilters(f => ({ ...f, preferred_day: v }))} placeholder="All Preferred Days" options={DAY_OPTIONS} />
            <FilterSelect value={filters.service} onChange={v => setFilters(f => ({ ...f, service: v }))} placeholder="All Services" options={services} />
            <FilterSelect value={filters.suburb} onChange={v => setFilters(f => ({ ...f, suburb: v }))} placeholder="All Suburbs" options={suburbs} />
            <FilterSelect value={filters.confirmation_status} onChange={v => setFilters(f => ({ ...f, confirmation_status: v }))} placeholder="All Confirmation" options={CONFIRMATION_STATUS_OPTIONS.map(s => CONFIRMATION_STATUS_LABEL[s])} values={CONFIRMATION_STATUS_OPTIONS} />
          </div>
        )}
      </div>

      {/* Board: always one horizontal row, fixed height, independent scroll */}
      {loading ? (
        <div className="flex justify-center py-24"><div className="w-6 h-6 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" /></div>
      ) : viewMode === 'week' ? (
        <WeekViewTab columns={columns} weekMode={weekMode} setWeekMode={setWeekMode} onCardClick={setWeekClient} />
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex items-start gap-2 overflow-x-auto pb-2 wf-scroll">
            {STAGES.map(stage => {
              const tint = COLUMN_TINT[stage];
              const Icon = STAGE_ICON[stage];
              const items = columns[stage];
              const grouped = groupByDay(items, stage);
              return (
                <div key={stage} className={cn('flex min-w-[190px] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200', tint.bg)} style={{ maxHeight: 'calc(100vh - 300px)' }}>
                  <div className={cn('h-1 rounded-t-xl', tint.bar)} />
                  <div className="shrink-0 border-b border-zinc-200/80 bg-white/60 px-2.5 py-2 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5">
                      <Icon className={cn('w-3.5 h-3.5', tint.head)} />
                      <h3 className="truncate text-[13px] font-semibold text-zinc-800">{STAGE_LABEL[stage]}</h3>
                      <span className={cn('ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-bold', tint.chip)}>{counts[stage]}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-zinc-500">{STAGE_META[stage].desc}</p>
                  </div>
                  <Droppable droppableId={stage}>
                    {(provided, snap) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={cn('flex-1 min-h-[64px] space-y-1.5 overflow-y-auto wf-scroll p-1.5', snap.isDraggingOver && 'bg-white/50')}>
                        {/* An empty stage says what it holds rather than leaving a tall blank column. */}
                        {grouped.length === 0 && (
                          <div className="flex flex-col items-center gap-1 px-2 py-4 text-center">
                            <Icon className={cn('h-4 w-4 opacity-40', tint.head)} />
                            <p className="text-[11px] font-semibold text-zinc-400">No clients</p>
                            <p className="text-[10px] leading-tight text-zinc-400">Nobody is at this stage this week.</p>
                          </div>
                        )}
                        {grouped.map((grp, gi) => (
                          <div key={gi}>
                            {grp.day && (stage === 'time_received' || stage === 'confirmed' || stage === 'waiting_on_response') && (
                              <div className="flex items-center gap-2 px-1 pt-1.5 pb-1">
                                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{grp.day}</span>
                                <span className="flex-1 h-px bg-zinc-200" />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              {grp.cards.map((c, idx) => (
                                <Draggable key={c.id} draggableId={c.id} index={c._globalIndex}>
                                  {(p, s) => (
                                    <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps}
                                      className={cn('relative rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md', s.isDragging && 'shadow-lg ring-2 ring-[#6366F1]/40')}>
                                      <div className="flex items-start gap-1.5">
                                        <button onClick={() => setEditFor(c)} className="group flex min-w-0 flex-1 items-start gap-1.5 text-left">
                                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">{initials(c.client_name)}</div>
                                          <div className="min-w-0 flex-1">
                                            <p className="truncate text-[13px] font-semibold leading-tight text-zinc-900 transition-colors group-hover:text-indigo-600">{c.client_name}</p>
                                            <p className="truncate text-[10px] leading-tight text-zinc-500">{c.usual_service || '—'}</p>
                                          </div>
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === c.id ? null : c.id); }} className="-mr-1 -mt-1 flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                                      </div>

                                      {/* Three attribute pills */}
                                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                        {c.frequency && <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', FREQUENCY_STYLES[c.frequency] || 'bg-zinc-100 text-zinc-600')}>{c.frequency}</span>}
                                        {c.scheduling_category && <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', CATEGORY_STYLES[c.scheduling_category] || 'bg-zinc-100 text-zinc-600')}>{c.scheduling_category}</span>}
                                        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', CLIENT_TYPE_STYLES[c.client_type || 'New'] || 'bg-zinc-100 text-zinc-600')}>{c.client_type || 'New'}</span>
                                      </div>

                                      {/* Stage-specific meta */}
                                      {stage === 'needs_reminder' && <p className="mt-1.5 text-[10px] text-zinc-500">Due: <span className="font-medium text-zinc-700">{formatDueDate(c.next_reminder_date)}</span></p>}
                                      {stage === 'waiting_on_response' && (
                                        <div className="mt-1.5 space-y-0.5">
                                          <p className="text-[11px] text-zinc-500">Sent: <span className="text-zinc-700 font-medium">{formatDueDate(c.reminder_sent_date)}</span></p>
                                          <p className="text-[11px] text-zinc-500">Follow-up due: <span className="text-zinc-700 font-medium">{formatDueDate(followUpDueDate(c.reminder_sent_date))}</span></p>
                                        </div>
                                      )}
                                      {stage === 'time_received' && (
                                        <div className="mt-1.5 space-y-0.5">
                                          <p className="text-[11px] text-zinc-500">Available: <span className="text-zinc-700 font-medium">{c.received_day || c.preferred_day || 'Flexible'} {c.availability_window || ''}</span></p>
                                          {c.suburb && <p className="text-[11px] text-zinc-500">{c.suburb}</p>}
                                          <span className={cn('inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded', TIME_RECEIVED_STATUS_STYLES[c.time_received_status || 'waiting'])}>{TIME_RECEIVED_STATUS_LABEL[c.time_received_status || 'waiting']}</span>
                                        </div>
                                      )}
                                      {stage === 'confirmed' && (
                                        <div className="mt-1.5 space-y-0.5">
                                          <p className="text-[11px] text-zinc-500">{confirmedDayOfWeek(c)}, {formatDateShort(c.confirmed_date)} · {c.confirmed_time || '—'}{c.suburb && <span className="text-zinc-400"> · {c.suburb}</span>}</p>
                                          <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded', CONFIRMATION_STATUS_STYLES[c.confirmation_status || 'waiting_confirmation'])}>
                                            {c.confirmation_status === 'client_confirmed' ? '✅' : '⌛️'} {CONFIRMATION_STATUS_LABEL[c.confirmation_status || 'waiting_confirmation']}
                                          </span>
                                        </div>
                                      )}

                                      {/* Actions */}
                                      <div className="mt-2 flex flex-wrap items-center gap-1">
                                        {stage === 'needs_reminder' && (
                                          <button onClick={() => sendReminder(c)} disabled={busy} className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-white', tint.btn)}><Send className="w-3 h-3 inline -mt-0.5 mr-1" />Send Reminder</button>
                                        )}
                                        {stage === 'waiting_on_response' && (
                                          <>
                                            <button onClick={() => sendFollowUp(c)} disabled={busy} className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-white', tint.btn)}><Send className="w-3 h-3 inline -mt-0.5 mr-1" />Follow-up</button>
                                            <button onClick={() => markReplied(c)} disabled={busy} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"><Check className="w-3 h-3 inline -mt-0.5 mr-1" />Replied</button>
                                          </>
                                        )}
                                        {stage === 'time_received' && (
                                          <>
                                            <button onClick={() => addToCalendar(c)} disabled={busy} className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-white', tint.btn)}><CalendarPlus className="w-3 h-3 inline -mt-0.5 mr-1" />Add to Calendar</button>
                                            <button onClick={() => openSchedule(c)} disabled={c.time_received_status !== 'added_to_schedule'} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed" title={c.time_received_status !== 'added_to_schedule' ? 'Add to Calendar first' : 'Open Schedule'}><CalendarDays className="w-3 h-3 inline -mt-0.5 mr-1" />Schedule</button>
                                          </>
                                        )}
                                        {stage === 'confirmed' && (
                                          <>
                                            <button onClick={() => sendAppointmentCheck(c)} disabled={busy} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"><BellRing className="w-3 h-3 inline -mt-0.5 mr-1" />Check</button>
                                            <Link to="/admin/schedule" className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-white', tint.btn)}><CalendarDays className="w-3 h-3 inline -mt-0.5 mr-1" />Calendar</Link>
                                          </>
                                        )}
                                        <button onClick={() => setChatFor(c)} className="text-[11px] font-medium px-2 py-1 rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50" title="Expand chat"><MessageCircle className="w-3 h-3" /></button>
                                        <button onClick={() => setEditFor(c)} className="text-[11px] font-medium px-2 py-1 rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50" title="Edit"><Pencil className="w-3 h-3" /></button>
                                      </div>

                                      {menuFor === c.id && (
                                        <>
                                          <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                                          <div className="absolute right-2 top-10 z-40 w-48 bg-white border border-zinc-200 rounded-lg shadow-xl py-1">
                                            <p className="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Move Reminder</p>
                                            <button onClick={() => { setMenuFor(null); moveReminderToWeek(c, 1, 'Next Week'); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">Move to Next Week</button>
                                            <button onClick={() => { setMenuFor(null); moveReminderToWeek(c, 2, 'Week After'); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">Move to Week After</button>
                                            <button onClick={() => { setMenuFor(null); moveReminder3Weeks(c); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">Move 3 Weeks Ahead</button>
                                            <button onClick={() => openChooseDate(c)} className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">Choose Date…</button>
                                            <div className="border-t border-zinc-100 my-1" />
                                            <p className="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Client Actions</p>
                                            <Link to="/admin/clients" className="block px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">View Client Profile</Link>
                                            <button onClick={() => { setMenuFor(null); setEditFor(c); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">Edit Client</button>
                                            <button onClick={() => { setMenuFor(null); pauseReminders(c); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">Pause Reminders</button>
                                            <button onClick={() => { setMenuFor(null); skipCycle(c); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">Skip This Cycle</button>
                                            <div className="border-t border-zinc-100 my-1" />
                                            <p className="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Remove</p>
                                            <button onClick={() => { setMenuFor(null); setConfirmRemoveFor(c); }} className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">Remove From This Week</button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                            </div>
                          </div>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}

      {/* Footer banner */}
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
          <Lightbulb className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-amber-800 leading-relaxed"><span className="font-semibold">How it works:</span> Move clients through the pipeline as they progress. Add to Calendar creates a draft request on the Schedule — organise and confirm the exact time there. Messages are queued in Messages.</p>
        </div>
      </div>

      {/* Review reminders modal */}
      {reviewOpen && (
        <Modal title="Send Weekly Reminders" subtitle="Review each message before preparing. Messages are queued — send them from Messages." onClose={() => setReviewOpen(false)}>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 wf-scroll">
            {reviewDrafts.length === 0 && <p className="text-sm text-zinc-500">No clients need a reminder right now.</p>}
            {reviewDrafts.map((d) => (
              <div key={d.id} className="rounded-lg border border-zinc-200 p-3">
                <p className="text-sm font-semibold text-zinc-900 mb-1.5">{d.client_name}</p>
                <Textarea value={d.message} onChange={e => setReviewDrafts(prev => prev.map(p => p.id === d.id ? { ...p, message: e.target.value } : p))} rows={2} className="bg-white border-zinc-200 text-zinc-900" />
                <div className="flex justify-between mt-1"><span className="text-[10px] text-zinc-400">{d.message.length}/160</span><span className="text-[10px] text-zinc-400">Default: “{DEFAULT_MESSAGE}”</span></div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" className="bg-white border-zinc-200 text-zinc-700" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button onClick={sendBatch} disabled={reviewDrafts.length === 0 || busy} className="bg-[#6366F1] hover:bg-[#5457e6] text-white">{reviewDrafts.length ? `Prepare ${reviewDrafts.length} Reminders` : 'Prepare'}</Button>
          </div>
        </Modal>
      )}

      {/* Completed modal */}
      {completedOpen && (
        <Modal title="Completed Services" subtitle="Services marked complete in Bookings / Services." onClose={() => setCompletedOpen(false)}>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-100 wf-scroll">
            {completed.length === 0 && <p className="text-sm text-zinc-500 py-8 text-center">No completed services yet.</p>}
            {completed.map(b => (
              <div key={b.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{b.client_name || '—'}</p>
                  <p className="text-[11px] text-zinc-500">{(b.services || []).join(', ') || b.time_block} · {b.day} {b.assigned_time || ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-zinc-900">${b.price || 0}</p>
                  <p className="text-[11px] text-zinc-400">{formatDateShort(b.created_date)}</p>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Choose date modal */}
      {datePickFor && (
        <Modal title="Move Reminder" subtitle={`Choose a new reminder date for ${datePickFor.client_name}.`} onClose={() => setDatePickFor(null)}>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600">Reminder date (up to 1 month ahead)</label>
            <input type="date" value={dateValue} min={new Date().toISOString().slice(0, 10)} max={new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10)} onChange={e => setDateValue(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900" />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" className="bg-white border-zinc-200 text-zinc-700" onClick={() => setDatePickFor(null)}>Cancel</Button>
            <Button onClick={applyChooseDate} disabled={!dateValue || busy} className="bg-[#6366F1] hover:bg-[#5457e6] text-white">Move Reminder</Button>
          </div>
        </Modal>
      )}

      {/* Remove confirmation modal */}
      {confirmRemoveFor && (
        <Modal title="Remove From This Week" onClose={() => setConfirmRemoveFor(null)}>
          <p className="text-sm text-zinc-700">Remove this client from this week's workflow?</p>
          <p className="text-xs text-zinc-500 mt-1">{confirmRemoveFor.client_name} will reappear when their next reminder is due. Their permanent frequency won't change.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" className="bg-white border-zinc-200 text-zinc-700" onClick={() => setConfirmRemoveFor(null)}>Cancel</Button>
            <Button onClick={() => { const cl = confirmRemoveFor; setConfirmRemoveFor(null); removeFromThisWeek(cl); }} className="bg-red-600 hover:bg-red-700 text-white">Remove</Button>
          </div>
        </Modal>
      )}

      {/* Expand chat */}
      {chatFor && (
        <ChatPanel client={chatFor} onClose={() => setChatFor(null)} onSend={() => flash('Reply added to Messages')} />
      )}

      {/* Week view client drawer */}
      {weekClient && (
        <WeekClientDrawer
          client={weekClient}
          onClose={() => setWeekClient(null)}
          onSendReminder={(c) => { sendReminder(c); setWeekClient(null); }}
          onFollowUp={(c) => { sendFollowUp(c); setWeekClient(null); }}
          onMarkReplied={(c) => { markReplied(c); setWeekClient(null); }}
          onAddToSchedule={(c) => { addToCalendar(c); openSchedule(c); setWeekClient(null); }}
          onOpenChat={(c) => { setChatFor(c); setWeekClient(null); }}
          onMoveRequest={(c) => { openChooseDate(c); setWeekClient(null); }}
          onSkipCycle={(c) => { skipCycle(c); setWeekClient(null); }}
          onPauseReminders={(c) => { pauseReminders(c); setWeekClient(null); }}
          onNotInterested={(c) => { notInterested(c); setWeekClient(null); }}
          busy={busy}
        />
      )}

      {/* Edit panel */}
      {editFor && (
        <ClientDrawer client={editFor} onClose={() => setEditFor(null)}
          onSave={async (patch) => { await run(async () => { await base44.entities.ReminderClient.update(editFor.id, patch); await load(); setEditFor(null); }, 'Changes saved', 'Could not save changes. Please try again.'); }}
          onQuickSend={(client) => run(async () => {
            await base44.entities.ReminderClient.update(client.id, { workflow_stage: 'waiting_on_response', reminder_sent_date: new Date().toISOString(), follow_up_due_date: followUpDueDate(new Date().toISOString()), workflow_updated_date: new Date().toISOString() });
            await load();
          }, 'Reminder prepared', 'Reminder could not be prepared. Please try again.')} />
      )}

      {/* Single non-blocking toast */}
      {notice && (
        <div className="fixed bottom-5 right-5 z-[80]">
          <div className={cn('flex items-center gap-2 rounded-lg shadow-lg pl-3 pr-2 py-2.5 text-sm font-medium text-white max-w-xs', notice.kind === 'error' ? 'bg-red-600' : 'bg-emerald-600')}>
            {notice.kind === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle className="w-4 h-4 shrink-0" />}
            <span className="flex-1 leading-snug">{notice.msg}</span>
            <button onClick={dismissNotice} className="w-6 h-6 rounded hover:bg-white/20 flex items-center justify-center shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function groupByDay(items, stage) {
  if (stage === 'waiting_on_response') {
    const groups = {};
    items.forEach((c, i) => {
      const d = c.reminder_sent_date ? new Date(c.reminder_sent_date) : null;
      const key = d && !isNaN(d) ? `SENT ${d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}` : 'SENT —';
      (groups[key] = groups[key] || []).push({ ...c, _globalIndex: i });
    });
    return Object.entries(groups).map(([day, cards]) => ({ day, cards }));
  }
  if (stage !== 'time_received' && stage !== 'confirmed') {
    return [{ day: '', cards: items.map((c, i) => ({ ...c, _globalIndex: i })) }];
  }
  const groups = {};
  items.forEach((c, i) => {
    const day = stage === 'confirmed' ? confirmedDayKey(c) : dayKeyFor(c);
    (groups[day] = groups[day] || []).push({ ...c, _globalIndex: i });
  });
  return GROUP_DAY_ORDER.filter(d => groups[d]).map(d => ({ day: d === '__none__' ? 'No day selected' : d, cards: groups[d] }));
}

function dayKeyFor(client) {
  const rd = client.received_day;
  if (rd && rd !== 'Flexible') return rd;
  const pd = client.preferred_day;
  if (pd) return pd;
  return '__none__';
}

function confirmedDayKey(client) {
  if (client.confirmed_date) {
    const d = new Date(client.confirmed_date);
    if (!isNaN(d)) return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  }
  return dayKeyFor(client);
}

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl border border-zinc-200 shadow-xl flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h3 className="text-base font-bold text-zinc-900">{title}</h3>
            {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options, values }) {
  const NONE = '__any__';
  return (
    <select value={value || NONE} onChange={e => onChange(e.target.value === NONE ? '' : e.target.value)}
      className="w-full text-sm rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-800">
      <option value={NONE}>{placeholder}</option>
      {options.map((o, i) => <option key={o} value={values ? values[i] : o}>{o}</option>)}
    </select>
  );
}