import { formatDistanceToNow, format } from 'date-fns';
import { base44 } from '@/api/base44Client';

export const asList = (r) => (Array.isArray(r) ? r : (r?.items || []));
import { STALE_MINUTES } from '@/lib/jobOverdue';
export { STALE_MINUTES, JOB_STALE_MINUTES, jobView } from '@/lib/jobOverdue';

export const ago = (v) => (v ? formatDistanceToNow(new Date(v), { addSuffix: true }) : null);
export const stamp = (v) => (v ? format(new Date(v), 'd MMM, h:mm a') : null);

const startOfTodayIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/** Minutes since the sweep last ran, or null when there is no health record / no run. */
export function sweepAgeMinutes(health) {
  if (!health?.last_run_at) return null;
  return (Date.now() - new Date(health.last_run_at).getTime()) / 60000;
}

/** Everything the health panel and jobs panel show, read from real records only. */
export async function loadOverview() {
  const E = base44.entities;
  const out = (q) => E.MessageOutbox.count(q);
  const [health, settings, pending, claimed, failed, dead, suppressed, sentToday, simToday, arrival, outreach, followup, beats] = await Promise.all([
    E.OutboxHealth.list('-created_date', 1),
    E.MessagingSettings.list('-created_date', 1),
    out({ status: 'pending' }), out({ status: 'claimed' }), out({ status: 'failed' }),
    out({ status: 'dead_letter' }), out({ status: 'suppressed' }),
    out({ status: 'sent', updated_date: { $gte: startOfTodayIso() } }),
    out({ status: 'sent', updated_date: { $gte: startOfTodayIso() }, provider_message_id: { $regex: '^SIMULATED-' } }).catch(() => null),
    E.ArrivalRunLog.list('-run_at', 1),
    E.CampaignRun.filter({ stage: 'outreach' }, { sort: '-created_date', limit: 1 }),
    E.CampaignRun.filter({ stage: 'followup' }, { sort: '-created_date', limit: 1 }),
    E.JobHeartbeat.list('-created_date', 20),
  ]);
  return {
    health: asList(health)[0] || null,
    settings: asList(settings)[0] || null,
    counts: { pending, claimed, failed, dead, suppressed, sentToday, simToday },
    arrival: asList(arrival)[0] || null,
    outreach: asList(outreach)[0] || null,
    followup: asList(followup)[0] || null,
    beats: Object.fromEntries(asList(beats).map((b) => [b.job_key, b])),
    loadedAt: new Date().toISOString(),
  };
}

/** The messaging safety gate as saved. A missing record or value means allowlist (the safe default). */
export function currentMode(settings) {
  const m = settings?.messaging_mode;
  return { mode: m === 'off' || m === 'live' ? m : 'allowlist', isDefault: !m, numbers: settings?.allowlist_numbers || [] };
}

/** When a scheduled job is next expected: the next 5-minute mark (sweep) or the next hour (the others). */
export function nextExpected(key, from = new Date()) {
  const step = (key === 'sweep' ? 5 : 60) * 60000;
  return new Date(Math.ceil((from.getTime() + 1) / step) * step);
}

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'sent', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
  { key: 'suppressed', label: 'Suppressed' },
  { key: 'dead_letter', label: 'Dead-lettered' },
];

/** One page of outbox rows plus the Messages and clients needed to describe them honestly. */
export async function loadQueuePage(filter, cursor) {
  const E = base44.entities;
  let page;
  if (filter === 'delivered') {
    // "Delivered" exists only on Message rows confirmed by the provider's status callback.
    const msgs = asList(await E.Message.filter({ delivery_status: 'delivered', simulated: { $ne: true }, outbox_id: { $exists: true } }, { sort: '-created_date', limit: 50 }));
    const ids = [...new Set(msgs.map((m) => m.outbox_id).filter(Boolean))];
    const rows = ids.length ? asList(await E.MessageOutbox.filter({ id: { $in: ids } }, { limit: 50 })) : [];
    page = { items: rows, next_cursor: null, has_more: false };
  } else {
    const q = filter === 'all' ? {} : { status: filter };
    page = await E.MessageOutbox.filter(q, { sort: '-created_date', limit: 25, ...(cursor ? { cursor } : {}) });
  }
  const items = asList(page);
  const oIds = items.map((o) => o.id);
  const cIds = [...new Set(items.map((o) => o.client_id).filter(Boolean))];
  const [msgs, clients] = await Promise.all([
    oIds.length ? E.Message.filter({ outbox_id: { $in: oIds } }, { limit: 100 }) : [],
    cIds.length ? E.ReminderClient.filter({ id: { $in: cIds } }, { limit: 100 }) : [],
  ]);
  return {
    items,
    messages: Object.fromEntries(asList(msgs).map((m) => [m.outbox_id, m])),
    clients: Object.fromEntries(asList(clients).map((c) => [c.id, c])),
    next: page?.has_more ? page.next_cursor : null,
  };
}

/** The one honest status label for an outbox row. Queued is never delivered; simulated is never real. */
export function describeStatus(o, msg) {
  const simulated = msg?.simulated === true || String(o.provider_message_id || '').startsWith('SIMULATED-');
  if (o.status === 'sent') {
    if (simulated) return { label: 'Simulated send — not delivered', key: 'test' };
    if (msg?.delivery_status === 'delivered' || msg?.delivery_status === 'read') return { label: 'Delivered (provider-confirmed)', key: 'delivered' };
    if (msg?.delivery_status === 'failed') return { label: 'Sent, then failed', key: 'failed' };
    return { label: 'Sent — delivery not confirmed', key: 'waiting' };
  }
  const map = {
    pending: { label: 'Pending — not sent', key: 'pending' },
    claimed: { label: 'Claimed — being processed', key: 'claimed' },
    failed: { label: 'Failed', key: 'failed' },
    dead_letter: { label: 'Dead-lettered — gave up', key: 'dead_letter' },
    suppressed: { label: 'Suppressed — never sent', key: 'suppressed' },
  };
  return map[o.status] || { label: String(o.status || 'Unknown'), key: 'neutral' };
}