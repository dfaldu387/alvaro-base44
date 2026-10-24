import { differenceInCalendarDays, parseISO, format } from 'date-fns';

export const CLIENT_STATUSES = ['No Booking Yet', 'Active', 'Inactive', 'Paused'];

export const STATUS_STYLES = {
  'No Booking Yet': 'bg-blue-50 text-blue-700',
  'Active': 'bg-emerald-50 text-emerald-700',
  'Inactive': 'bg-orange-50 text-orange-700',
  'Paused': 'bg-amber-50 text-amber-700',
};

export const STATUS_ORDER = { Active: 0, 'No Booking Yet': 1, Inactive: 2, Paused: 3 };

export const AVAILABILITY_TYPES = ['Fixed Time', 'Fixed Window', 'Flexible', 'Not Configured'];

const INACTIVE_DAYS = { 'Weekly': 21, 'Fortnightly': 35, 'Every 3 weeks': 42, 'Monthly': 49 };
const FREQ_LABELS = { 'Weekly': 'Weekly', 'Fortnightly': 'Fortnightly', 'Every 3 weeks': 'Every 3 Weeks', 'Monthly': 'Monthly' };
const norm = (s) => (s || '').toLowerCase().trim();

export function normalisePhone(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/^'+/, '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('61')) return '+' + s;
  if (s.startsWith('0')) return '+61' + s.slice(1);
  if (s.length === 9) return '+61' + s;
  return s;
}

export function formatPhoneAu(raw) {
  const n = normalisePhone(raw);
  if (!n) return '';
  let local = n.startsWith('+61') ? '0' + n.slice(3) : n;
  local = local.replace(/\D/g, '');
  if (local.length === 10 && local.startsWith('04')) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  if (local.length === 9 && local.startsWith('0')) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  return local;
}

export function frequencyDisplay(client) {
  const f = client && client.frequency;
  if (!f || f === 'Whenever') return 'None';
  return f;
}

export function availabilityTypeDisplay(client) {
  const c = client && client.scheduling_category;
  if (c === 'Fixed Time' || c === 'Fixed Window' || c === 'Flexible') return c;
  return 'Not Configured';
}

export function inactiveThreshold(client) {
  if (client && client.recurring_enabled) {
    const f = client.recurring_frequency || client.frequency;
    return INACTIVE_DAYS[f] || 35;
  }
  return 35;
}

export function bookingsForClient(bookings, client) {
  const name = norm(client && client.client_name);
  if (!name) return [];
  return bookings.filter(b => norm(b.client_name) === name);
}

function visitDate(b) {
  const v = b.updated_date || b.created_date;
  return v ? new Date(v) : null;
}

export function completedForClient(bookings, client) {
  return bookingsForClient(bookings, client).filter(b => b.status === 'completed');
}

export function clientStatus(client, completed) {
  if (!client) return 'No Booking Yet';
  if (client.is_paused) return 'Paused';
  if (!completed || completed.length === 0) return 'No Booking Yet';
  const last = lastVisitDate(completed);
  if (!last) return 'No Booking Yet';
  return differenceInCalendarDays(new Date(), last) <= inactiveThreshold(client) ? 'Active' : 'Inactive';
}

export function lastVisitDate(completed) {
  const dates = (completed || []).map(visitDate).filter(d => d && !isNaN(d));
  if (!dates.length) return null;
  return new Date(Math.max(...dates));
}

export function firstVisitDate(completed) {
  const dates = (completed || []).map(visitDate).filter(d => d && !isNaN(d));
  if (!dates.length) return null;
  return new Date(Math.min(...dates));
}

export function frequentServices(completed) {
  const counts = {};
  (completed || []).forEach(b => (b.services || []).forEach(s => { if (s) counts[s] = (counts[s] || 0) + 1; }));
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 4);
}

export function relativeVisit(date) {
  if (!date) return 'No visits yet';
  const d = date instanceof Date ? date : parseISO(date);
  if (isNaN(d)) return 'No visits yet';
  const days = differenceInCalendarDays(new Date(), d);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === 7) return '7 days ago';
  if (days < 14) return `${days} days ago`;
  if (days < 28) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'A month ago';
  return `${Math.floor(days / 30)} months ago`;
}

export function formatVisitDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : parseISO(date);
  if (isNaN(d)) return '—';
  return format(d, 'd MMM yyyy');
}

export function findDuplicate(client, allClients) {
  if (!client) return null;
  const ph = normalisePhone(client.phone), em = norm(client.email);
  if (!ph && !em) return null;
  return (allClients || []).find(c => c.id !== client.id && ((ph && normalisePhone(c.phone) === ph) || (em && norm(c.email) === em))) || null;
}

export function needsSetup(client, stats) {
  if (!client) return true;
  const hasPhone = !!normalisePhone(client.phone);
  const hasEmail = !!(client.email || '').trim();
  if (!hasPhone && !hasEmail) return true;
  if (client.recurring_enabled && !(client.recurring_frequency || client.frequency)) return true;
  if (!client.scheduling_category) return true;
  if (client.last_visit_date && stats.visits === 0) return true;
  return false;
}

export function clientStats(client, completed) {
  const visits = (completed || []).length;
  const last = lastVisitDate(completed);
  const first = firstVisitDate(completed);
  const daysSinceLast = last ? differenceInCalendarDays(new Date(), last) : null;
  const lifetimeSpend = (completed || []).reduce((sum, b) => sum + (Number(b.price) || 0), 0);
  const txCount = (completed || []).filter(b => b.price != null).length;
  const avgSpend = visits ? lifetimeSpend / visits : 0;
  return {
    status: clientStatus(client, completed),
    visits, lastVisit: last, firstVisit: first, daysSinceLast,
    recurring_enabled: !!client.recurring_enabled,
    recurring_paused: !!client.recurring_paused,
    weekly_confirmation: client.recurring_weekly_confirmation !== false,
    frequency: client.frequency, is_paused: !!client.is_paused,
    availability: availabilityTypeDisplay(client),
    lifetimeSpend, avgSpend, txCount,
  };
}

export function systemTags(client, stats) {
  const tags = [stats.status];
  if (stats.recurring_enabled) tags.push('Recurring');
  const f = client.recurring_enabled ? (client.recurring_frequency || client.frequency) : client.frequency;
  if (FREQ_LABELS[f]) tags.push(FREQ_LABELS[f]);
  const at = availabilityTypeDisplay(client);
  if (at !== 'Not Configured') tags.push(at);
  return tags;
}

export const SMART_GROUPS = [
  { key: 'needs_setup', label: 'Needs Setup', test: (s, c) => needsSetup(c, s) },
  { key: 'active', label: 'Active', test: s => s.status === 'Active' },
  { key: 'inactive', label: 'Inactive', test: s => s.status === 'Inactive' },
  { key: 'no_booking_yet', label: 'No Booking Yet', test: s => s.status === 'No Booking Yet' },
  { key: 'paused', label: 'Paused', test: s => s.status === 'Paused' },
  { key: 'recurring', label: 'Recurring Clients', test: s => s.recurring_enabled },
  { key: 'weekly', label: 'Weekly Clients', test: s => s.frequency === 'Weekly' },
  { key: 'fortnightly', label: 'Fortnightly Clients', test: s => s.frequency === 'Fortnightly' },
  { key: 'every_3_weeks', label: 'Every 3 Weeks Clients', test: s => s.frequency === 'Every 3 weeks' },
  { key: 'monthly', label: 'Monthly Clients', test: s => s.frequency === 'Monthly' },
  { key: 'fixed_time', label: 'Fixed Time Clients', test: s => s.availability === 'Fixed Time' },
  { key: 'fixed_window', label: 'Fixed Window Clients', test: s => s.availability === 'Fixed Window' },
  { key: 'flexible', label: 'Flexible Clients', test: s => s.availability === 'Flexible' },
  { key: 'not_configured', label: 'Not Configured Clients', test: s => s.availability === 'Not Configured' },
  { key: 'no_visit_35', label: 'No Visit in 35+ Days', test: s => s.daysSinceLast != null && s.daysSinceLast > 35 },
  { key: 'no_visit_60', label: 'No Visit in 60+ Days', test: s => s.daysSinceLast != null && s.daysSinceLast > 60 },
  { key: 'high_value', label: 'High-Value Clients', test: s => s.lifetimeSpend >= 200 },
  { key: 'new_clients', label: 'New Clients', test: s => s.visits === 0 && !s.is_paused },
];

export function matchFilters(client, stats, f) {
  if (!f) return true;
  if (f.status && f.status.length && !f.status.includes(stats.status)) return false;
  if (f.frequency && f.frequency.length && !f.frequency.includes(frequencyDisplay(client))) return false;
  if (f.availability && f.availability.length && !f.availability.includes(availabilityTypeDisplay(client))) return false;
  if (f.recurring === 'enabled' && !stats.recurring_enabled) return false;
  if (f.recurring === 'disabled' && stats.recurring_enabled) return false;
  if (f.recurring_paused && !stats.recurring_paused) return false;
  if (f.weekly_confirmation && !stats.weekly_confirmation) return false;
  if (f.no_visits && stats.visits !== 0) return false;
  if (f.last_visit_35 && !(stats.daysSinceLast != null && stats.daysSinceLast > 35)) return false;
  if (f.visit_min && stats.visits < Number(f.visit_min)) return false;
  if (f.last_visit_from) { if (!stats.lastVisit || stats.lastVisit < new Date(f.last_visit_from)) return false; }
  if (f.last_visit_to) { if (!stats.lastVisit || stats.lastVisit > new Date(f.last_visit_to + 'T23:59:59')) return false; }
  if (f.first_visit_from) { if (!stats.firstVisit || stats.firstVisit < new Date(f.first_visit_from)) return false; }
  if (f.first_visit_to) { if (!stats.firstVisit || stats.firstVisit > new Date(f.first_visit_to + 'T23:59:59')) return false; }
  if (f.created_from) { if (!client.created_date || new Date(client.created_date) < new Date(f.created_from)) return false; }
  if (f.created_to) { if (!client.created_date || new Date(client.created_date) > new Date(f.created_to + 'T23:59:59')) return false; }
  if (f.has_phone && !client.phone) return false;
  if (f.has_email && !client.email) return false;
  if (f.has_address && !(client.address || client.suburb)) return false;
  if (f.has_notes && !client.notes) return false;
  if (f.has_manual_tags && !(client.manual_tags || []).length) return false;
  if (f.suburb && f.suburb.length && !f.suburb.includes(client.suburb)) return false;
  if (f.postcode && f.postcode.length && !f.postcode.includes(client.postcode)) return false;
  if (f.service && f.service.length && !f.service.includes(client.usual_service)) return false;
  if (f.avg_min && stats.avgSpend < Number(f.avg_min)) return false;
  if (f.lt_min && stats.lifetimeSpend < Number(f.lt_min)) return false;
  if (f.tx_min && stats.txCount < Number(f.tx_min)) return false;
  return true;
}

export function countActiveFilters(f) {
  if (!f) return 0;
  let n = 0;
  if (f.status && f.status.length) n++;
  if (f.frequency && f.frequency.length) n++;
  if (f.availability && f.availability.length) n++;
  if (f.recurring && f.recurring !== 'any') n++;
  if (f.recurring_paused) n++;
  if (f.weekly_confirmation) n++;
  if (f.no_visits) n++;
  if (f.last_visit_35) n++;
  if (f.visit_min) n++;
  if (f.last_visit_from) n++;
  if (f.last_visit_to) n++;
  if (f.first_visit_from) n++;
  if (f.first_visit_to) n++;
  if (f.created_from) n++;
  if (f.created_to) n++;
  if (f.has_phone) n++;
  if (f.has_email) n++;
  if (f.has_address) n++;
  if (f.has_notes) n++;
  if (f.has_manual_tags) n++;
  if (f.suburb && f.suburb.length) n++;
  if (f.postcode && f.postcode.length) n++;
  if (f.service && f.service.length) n++;
  if (f.avg_min) n++;
  if (f.lt_min) n++;
  if (f.tx_min) n++;
  return n;
}