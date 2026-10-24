import { format } from 'date-fns';

/**
 * The audit trail: a READ of the ActivityLog rows the server writes through recordAudit (and the two mode switches
 * that write beside it). Nothing is written here and nothing is re-scrubbed: the server already removed phone numbers
 * and email addresses before the row was saved, so what this shows is exactly what was kept.
 *
 * It is its own view, not a filter on Route Flow Activity: that feed is a scheduling history organised by day and
 * built around Route Flow's own events (placements, reshuffles). The audit trail answers a different question
 * for a different reader: who changed money, people or data, and when.
 */
export const AUDIT_CATEGORIES = [
  { value: 'all', label: 'Everything', patterns: null },
  { value: 'payments', label: 'Payments', patterns: ['payment_'] },
  { value: 'deletions', label: 'Deletions', patterns: ['clients_deleted', 'test_data_deleted'] },
  { value: 'staff', label: 'Staff', patterns: ['staff_', 'team_member_'] },
  { value: 'messages', label: 'Messages sent', patterns: ['manual_message_', 'assistant_draft_', 'outbox_requeued'] },
  { value: 'bookings', label: 'Bookings', patterns: ['booking_'] },
  { value: 'settings', label: 'Settings and jobs', patterns: ['campaign_dry_run_', 'messaging_', 'assistant_mode_', 'cadence_backfill', 'settings_'] },
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every action prefix or name the audit trail covers (used by "Everything" and by the source guard). */
export const ALL_PATTERNS = AUDIT_CATEGORIES.flatMap((c) => c.patterns || []);

/** The server-side filter for a category. */
export function auditQuery(category) {
  const cat = AUDIT_CATEGORIES.find((c) => c.value === category) || AUDIT_CATEGORIES[0];
  const patterns = cat.patterns || ALL_PATTERNS;
  return { action: { $regex: `^(${patterns.map(escape).join('|')})` } };
}

export function categoryOfAction(action) {
  const a = String(action || '');
  const hit = AUDIT_CATEGORIES.find((c) => c.patterns && c.patterns.some((p) => a.startsWith(p)));
  return hit ? hit.value : null;
}

/** A plain-language name for the action when the row has no summary. */
const prettyAction = (a) => String(a || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function normaliseAudit(row) {
  const when = row.timestamp || row.created_date || null;
  return {
    id: row.id,
    category: categoryOfAction(row.action),
    what: row.summary || prettyAction(row.action),
    action: row.action,
    who: row.actor_name || 'Unknown',
    automatic: row.actor_type === 'route_flow',
    when,
    outcome: row.outcome || 'applied',
    detail: row.detail || [row.previous_value, row.new_value].filter(Boolean).join(' → ') || '',
    bookingId: row.details_json?.ids?.booking_request_id || null,
  };
}

export function formatWhen(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, 'd MMM yyyy, h:mmaaa') : '';
}

/** One page, newest first. `cursor` continues from the previous page. */
export async function loadAudit(base44, { category = 'all', cursor = null, limit = 40 } = {}) {
  const page = await base44.entities.ActivityLog.filter(auditQuery(category), { sort: '-created_date', limit, ...(cursor ? { cursor } : {}) });
  return { items: (page.items || []).map(normaliseAudit), next: page.has_more ? page.next_cursor : null };
}