/**
 * Audit trail for changes a person makes: ONE writer for the ActivityLog rows that
 * say who did what and when. It writes the same ActivityLog records the rest of the
 * app already writes (setMessagingMode, Route Flow, reviews); it is not a second log.
 *
 * Rules built in, so callers cannot get them wrong:
 *  - Counts and identifiers only. A row never carries a phone number, an email
 *    address, a message body, an address or card details. Numbers go in `counts`,
 *    system ids in `ids`, and the only free text (`summary`, `note`) is scrubbed of
 *    anything that looks like a phone number or an email address.
 *  - A read is never audited. Call this only where something changed.
 *  - For a destructive action, call `recordAudit` BEFORE the change and refuse the
 *    action when it returns null: nothing is changed without a record of who did it.
 *    Then call `finishAudit` with the final counts. It is the same row, so an action
 *    always leaves exactly one.
 */

export type AuditRelated = 'Client' | 'BookingRequest' | 'Message' | 'DayRoute' | 'Appointment';

export interface AuditEntry {
  /** Short machine name, e.g. clients_deleted. */
  action: string;
  /** The person who did it (never a customer). */
  who: string;
  /** True when a workflow, not a person, made the call. */
  automation?: boolean;
  /** One plain sentence. Scrubbed. */
  summary: string;
  note?: string;
  /** How many records of each kind. Only finite numbers are kept. */
  counts?: Record<string, number>;
  /** System ids only (booking id, outbox id...). Anything that is not a plain id is dropped. */
  ids?: Record<string, string | null | undefined>;
  related?: { type?: AuditRelated; id?: string | null };
  outcome?: 'applied' | 'failed' | 'aborted';
}

const PHONE_LIKE = /\+?\d(?:[\s().-]?\d){7,}/g;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;
// A value that is all digits is a phone number, not a system id (record ids contain letters).
const isId = (v: unknown): v is string => typeof v === 'string' && PLAIN_ID.test(v) && !/^\d{7,}$/.test(v);

/** Removes anything that looks like a phone number or an email address, and caps the length. */
export function scrub(text: unknown, max = 200): string {
  return String(text ?? '').replace(PHONE_LIKE, '[removed]').replace(EMAIL_LIKE, '[removed]').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The ActivityLog row for an entry. Pure, so it can be tested without a database. */
export function buildAuditRow(e: AuditEntry, now: Date = new Date()): Record<string, any> {
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.counts || {})) if (Number.isFinite(Number(v))) counts[k] = Number(v);
  const ids: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.ids || {})) if (isId(v)) ids[k] = v;
  const countText = Object.entries(counts).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ');
  const detail = [scrub(e.note), countText].filter(Boolean).join(' · ');
  return {
    action: e.action,
    actor: 'barber',
    actor_type: e.automation ? 'route_flow' : 'admin',
    actor_name: scrub(e.who, 80) || 'Unknown',
    outcome: e.outcome || 'applied',
    summary: scrub(e.summary),
    detail,
    details_json: { counts, ids },
    related_record_id: isId(e.related?.id) ? e.related!.id! : undefined,
    related_record_type: e.related?.type,
    timestamp: now.toISOString(),
  };
}

/** Writes the row and returns its id, or null when it could not be written. Never throws. */
export async function recordAudit(admin: any, e: AuditEntry): Promise<string | null> {
  try {
    const row = await admin.entities.ActivityLog.create(buildAuditRow(e));
    return row?.id || null;
  } catch (err) {
    console.error('[auditLog] write failed', e.action, (err as Error)?.message);
    return null;
  }
}

/** Replaces the row with its final state (final counts, outcome). Best effort: the intent row already exists. */
export async function finishAudit(admin: any, id: string | null, e: AuditEntry): Promise<boolean> {
  if (!id) return false;
  try {
    await admin.entities.ActivityLog.update(id, buildAuditRow(e));
    return true;
  } catch (err) {
    console.error('[auditLog] finish failed', e.action, (err as Error)?.message);
    return false;
  }
}

/** The response every fail-closed caller returns when the record could not be written. */
export const AUDIT_REFUSED = { error: 'This could not be recorded in the activity log, so nothing was changed.', code: 'AUDIT_FAILED' };