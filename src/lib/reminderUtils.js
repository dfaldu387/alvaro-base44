import { startOfWeek, addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

export const FREQUENCY_OPTIONS = ['Weekly', 'Fortnightly', 'Every 3 weeks', 'Monthly', 'Whenever'];
export const STATUS_OPTIONS = [
  'Due This Week', 'Due Next Week', 'Due Later', 'Waiting for Reply',
  'Needs Booking', 'Booked', 'Not This Week', 'Manual Follow-up', 'Paused',
];
export const DAY_OPTIONS = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const RECEIVED_DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Flexible'];
export const CATEGORY_OPTIONS = ['Fixed Time', 'Fixed Window', 'Flexible'];
export const CLIENT_TYPE_OPTIONS = ['New', 'Regular'];
export const CLIENT_TYPE_STYLES = {
  'New': 'bg-sky-100 text-sky-700',
  'Regular': 'bg-zinc-100 text-zinc-700',
};
export const CONFIRMATION_STATUS_OPTIONS = ['waiting_confirmation', 'client_confirmed'];
export const CONFIRMATION_STATUS_LABEL = {
  'waiting_confirmation': 'Waiting Confirmation',
  'client_confirmed': 'Client Confirmed',
};
export const CONFIRMATION_STATUS_STYLES = {
  'waiting_confirmation': 'bg-amber-100 text-amber-700',
  'client_confirmed': 'bg-emerald-100 text-emerald-700',
};
export const DEFAULT_MESSAGE = 'yoo bro, need a cut this week?';
export const DEFAULT_FOLLOWUP = 'hey bro, spots are filling up in case you needed a haircut this week';

export const SOURCE_OPTIONS = ['Reminder', 'Direct message', 'Website', 'Manual', 'Existing booking'];
export const SOURCE_STYLES = {
  'Reminder': 'bg-violet-100 text-violet-700',
  'Direct message': 'bg-blue-100 text-blue-700',
  'Website': 'bg-emerald-100 text-emerald-700',
  'Manual': 'bg-zinc-100 text-zinc-600',
  'Existing booking': 'bg-amber-100 text-amber-700',
};

export const TAG_OPTIONS = ['Regular', 'New client', 'VIP', 'Office client', 'Fixed time', 'Fixed window', 'Flexible', 'Needs follow-up'];
export const TAG_STYLES = {
  'Regular': 'bg-zinc-100 text-zinc-700',
  'New client': 'bg-sky-100 text-sky-700',
  'VIP': 'bg-purple-100 text-purple-700',
  'Office client': 'bg-indigo-100 text-indigo-700',
  'Fixed time': 'bg-blue-100 text-blue-700',
  'Fixed window': 'bg-cyan-100 text-cyan-700',
  'Flexible': 'bg-green-100 text-green-700',
  'Needs follow-up': 'bg-orange-100 text-orange-700',
};

export const FREQUENCY_DAYS = { 'Weekly': 7, 'Fortnightly': 14, 'Every 3 weeks': 21, 'Monthly': 30, 'Whenever': null, 'Custom': 30 };

export const FREQUENCY_STYLES = {
  'Weekly': 'bg-indigo-50 text-indigo-700',
  'Fortnightly': 'bg-sky-50 text-sky-700',
  'Every 3 weeks': 'bg-emerald-50 text-emerald-700',
  'Monthly': 'bg-orange-50 text-orange-700',
  'Whenever': 'bg-zinc-100 text-zinc-600',
  'Custom': 'bg-zinc-100 text-zinc-700',
};

export const STATUS_STYLES = {
  'Due This Week': 'bg-purple-100 text-purple-700',
  'Due Next Week': 'bg-blue-100 text-blue-700',
  'Due Later': 'bg-zinc-100 text-zinc-600',
  'Waiting for Reply': 'bg-amber-100 text-amber-700',
  'Needs Booking': 'bg-emerald-100 text-emerald-700',
  'Booked': 'bg-green-100 text-green-700',
  'Not This Week': 'bg-zinc-100 text-zinc-500',
  'Manual Follow-up': 'bg-orange-100 text-orange-700',
  'Paused': 'bg-amber-100 text-amber-700',
};

export const CATEGORY_STYLES = {
  'Fixed Time': 'bg-blue-100 text-blue-800',
  'Fixed Window': 'bg-emerald-100 text-emerald-800',
  'Flexible': 'bg-orange-100 text-orange-800',
};

export const ACTIVE_STYLE = 'bg-emerald-100 text-emerald-800';
export const PAUSED_STYLE = 'bg-amber-100 text-amber-800';

export const STAGES = ['needs_reminder', 'waiting_on_response', 'time_received', 'confirmed'];
export const STAGE_LABEL = { needs_reminder: 'Needs Reminder', waiting_on_response: 'Waiting on Client', time_received: 'Time Received', confirmed: 'Confirmed' };
export const STAGE_META = {
  needs_reminder: { title: 'Needs Reminder', desc: 'Clients due this week who haven\u2019t been contacted yet.', accent: 'amber' },
  waiting_on_response: { title: 'Waiting on Client', desc: 'A message has been sent or a conversation is active, but the client hasn\u2019t provided everything yet.', accent: 'blue' },
  time_received: { title: 'Time Received', desc: 'Client has provided their preferred day and availability window.', accent: 'yellow' },
  confirmed: { title: 'Confirmed', desc: 'Booking confirmed. See details or open in calendar.', accent: 'emerald' },
};

export const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Flexible'];

const SPECIAL_STATUS = new Set(['Booked', 'Needs Booking', 'Manual Follow-up', 'Waiting for Reply']);

export function initialStageForSource(source, hasAvailability) {
  if (source === 'Existing booking') return 'confirmed';
  if (source === 'Direct message' || source === 'Website') return hasAvailability ? 'time_received' : 'waiting_on_response';
  if (source === 'Manual') return 'needs_reminder';
  return 'needs_reminder';
}

export function frequencyDays(frequency, customDays) {
  if (frequency === 'Custom') return Math.max(1, Number(customDays) || 30);
  const v = FREQUENCY_DAYS[frequency];
  if (v == null) return null;
  return v;
}

export function computeNextReminder(lastVisit, frequency, customDays) {
  if (!lastVisit) return null;
  const days = frequencyDays(frequency, customDays);
  if (days == null) return null;
  const base = lastVisit instanceof Date ? lastVisit : parseISO(lastVisit);
  if (isNaN(base)) return null;
  return format(addDays(base, days), 'yyyy-MM-dd');
}

export function suggestClientType(client, completedBookings = []) {
  const hasCompleted = completedBookings.some(b => (b.client_name || '').toLowerCase() === (client.client_name || '').toLowerCase());
  let ageDays = 0;
  if (client.created_date) {
    const d = client.created_date instanceof Date ? client.created_date : parseISO(client.created_date);
    if (!isNaN(d)) ageDays = differenceInCalendarDays(new Date(), d);
  }
  if (hasCompleted && ageDays >= 30) return 'Regular';
  return 'New';
}

export function dateCategory(raw, isPaused) {
  if (isPaused) return 'paused';
  if (!raw) return 'due_later';
  const d = raw instanceof Date ? raw : parseISO(raw);
  if (isNaN(d)) return 'due_later';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sow = startOfWeek(today, { weekStartsOn: 1 });
  const nextMonday = addDays(sow, 7);
  const nextNextMonday = addDays(sow, 14);
  if (d < nextMonday) return 'due_this_week';
  if (d < nextNextMonday) return 'due_next_week';
  return 'due_later';
}

export function getCategorization(client) {
  if (client.is_paused) return 'paused';
  const s = client.reminder_status;
  if (s === 'Booked') return 'booked';
  if (s && SPECIAL_STATUS.has(s)) return 'needs_followup';
  return dateCategory(client.next_reminder_date, false);
}

export function categoryToStatus(cat) {
  return { due_this_week: 'Due This Week', due_next_week: 'Due Next Week', due_later: 'Due Later', needs_followup: 'Needs Booking', booked: 'Booked', paused: 'Paused' }[cat] || 'Due Later';
}

export function displayStage(client) {
  const s = client.workflow_stage;
  if (STAGES.includes(s)) return s;
  if (client.is_paused) return null;
  if (dateCategory(client.next_reminder_date, false) === 'due_this_week') return 'needs_reminder';
  return null;
}

export function availabilityStart(str = '') {
  const s = String(str).toLowerCase();
  if (!s) return 999;
  if (s.includes('flex') || s.includes('anyt')) return 0;
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return 500;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h + min / 60;
}

export function availabilityEnd(str = '') {
  const s = String(str).toLowerCase();
  if (!s) return -1;
  if (s.includes('flex') || s.includes('anyt')) return 2400;
  const matches = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g);
  if (!matches || matches.length === 0) return -1;
  const last = matches[matches.length - 1];
  const m = last.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return -1;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (matches.length === 1 && (s.includes('after') || s.includes('from'))) return h + min / 60 + 10;
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h + min / 60;
}

export function confirmedDayOfWeek(client) {
  if (!client.confirmed_date) return client.received_day || 'Flexible';
  const d = parseISO(client.confirmed_date);
  if (isNaN(d)) return 'Flexible';
  return format(d, 'EEEE');
}

export function formatDateShort(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : parseISO(value);
  if (isNaN(d)) return '—';
  return format(d, 'd MMM yyyy');
}

export function formatDateTimeShort(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : parseISO(value);
  if (isNaN(d)) return '—';
  return format(d, 'd MMM, h:mm a');
}

export function timeSince(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : parseISO(value);
  if (isNaN(d)) return '';
  const diff = differenceInCalendarDays(new Date(), d);
  if (diff <= 0) return 'Today';
  if (diff === 1) return '1 day ago';
  if (diff < 7) return `${diff} days ago`;
  return format(d, 'd MMM');
}

export function relativeLabel(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : parseISO(value);
  if (isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cmp = new Date(d); cmp.setHours(0, 0, 0, 0);
  const diff = differenceInCalendarDays(cmp, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === 2) return '2 days';
  if (diff > 0 && diff <= 7) return `${diff} days`;
  if (diff < 0) return 'Overdue';
  return '';
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const TIME_RECEIVED_STATUS_OPTIONS = ['waiting', 'added_to_schedule'];
export const TIME_RECEIVED_STATUS_LABEL = { waiting: 'Waiting', added_to_schedule: 'Added to Schedule' };
export const TIME_RECEIVED_STATUS_STYLES = {
  waiting: 'bg-yellow-100 text-yellow-700',
  added_to_schedule: 'bg-emerald-100 text-emerald-700',
};

export function weekStart(offset = 0) {
  return addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), offset * 7);
}

export function weekStartISO(offset = 0) {
  return format(weekStart(offset), 'yyyy-MM-dd');
}

export function inSelectedWeek(date, offset = 0) {
  if (!date) return offset === 0;
  const d = date instanceof Date ? date : parseISO(date);
  if (isNaN(d)) return offset === 0;
  const s = weekStart(offset);
  const e = addDays(s, 7);
  return d >= s && d < e;
}

export function currentWeekId(offset = 0) {
  return format(weekStart(offset), "yyyy-'W'II");
}

export function formatDueDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : parseISO(value);
  if (isNaN(d)) return '—';
  return format(d, 'EEE, d MMM');
}

export function followUpDueDate(sentDate) {
  if (!sentDate) return null;
  const d = sentDate instanceof Date ? sentDate : parseISO(sentDate);
  if (isNaN(d)) return null;
  return format(addDays(d, 3), 'yyyy-MM-dd');
}

export function stageForWeek(client, weekMode) {
  if (client.is_paused) return null;
  const ws = client.workflow_stage;
  const offset = weekMode === 'this_week' ? 0 : weekMode === 'next_week' ? 1 : 2;
  if (offset === 0) {
    if (STAGES.includes(ws)) return ws;
    if (dateCategory(client.next_reminder_date, false) === 'due_this_week') return 'needs_reminder';
    return null;
  }
  const cat = dateCategory(client.next_reminder_date, false);
  if (offset === 1 && cat === 'due_next_week') return 'needs_reminder';
  if (offset === 2 && cat === 'due_later') return 'needs_reminder';
  return null;
}