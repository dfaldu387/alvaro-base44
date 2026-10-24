import { normaliseAuPhone } from './auPhone.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from './auditLog.ts';

/**
 * Merge a duplicate client into the one being kept.
 *
 * What the old page did: rewrote every booking whose client_name matched, setting the
 * survivor's name, phone and email, then deleted the duplicate, as two separate
 * statements. Two different people with one name were one person to it, finished
 * visits lost the phone and email they were taken with, and a failure between the
 * statements left bookings pointing at a client that no longer existed.
 *
 * What this does instead:
 *   - matches bookings by client_id, never by name. A booking with no client id is
 *     counted and reported, and left exactly as it is;
 *   - re-points client_id on every matched booking, but only rewrites name, phone and
 *     email on bookings that are still open. A completed, no-show or cancelled booking
 *     keeps the details that were used on the day;
 *   - re-points every other entity that is READ by client_id (CLIENT_ENTITIES below), so
 *     nothing about the customer reads back empty after the merge. BookingPayment is
 *     included even though nothing reads it by client today: it is money attached to a
 *     person, and a payment pointing at a deleted customer cannot be explained later;
 *   - refuses when the two records have different phone numbers (probably two people),
 *     when one is test data and the other is not, or when it is the same record;
 *   - is all-or-nothing as far as this database allows: the audit row is written first,
 *     everything is moved, the duplicate is deleted LAST, and if any step fails every
 *     record is put back to the values recorded before the change;
 *   - writes ONE audit row (it is updated in place with a count per entity).
 *
 * Deliberately NOT re-pointed:
 *   - ActivityLog: it records what happened at the time, exactly like a completed
 *     booking's phone and email. Rewriting it would be rewriting history.
 *   - MessageOutbox: a queue that drains; each item is delivered or dead-lettered.
 *   - AssistantEvent: an event log, which is history.
 *   If MessageOutbox or AssistantEvent ever grows a read by client_id, it joins CLIENT_ENTITIES.
 */

export const FINISHED_STATUSES = ['completed', 'no_show', 'cancelled'];
const MAX_BOOKINGS = 1000;
const CHUNK = 500;

const asRows = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const phoneKey = (p: unknown) => normaliseAuPhone(p) || String(p ?? '').replace(/\D/g, '');

/** Entities read by client_id, in the order they are moved. Bookings are handled first, by planBookingMoves. */
export const CLIENT_ENTITIES: { entity: string; label: string }[] = [
  { entity: 'NoShowRecord', label: 'no_show_records' },
  { entity: 'BookingPayment', label: 'booking_payments' },
  { entity: 'Message', label: 'messages' },
  { entity: 'CampaignEntry', label: 'campaign_entries' },
  { entity: 'WorkflowItem', label: 'workflow_items' },
  { entity: 'RecurringSetup', label: 'recurring_setups' },
  { entity: 'Appointment', label: 'appointments' },
  { entity: 'BookingReplyFlag', label: 'reply_flags' },
  { entity: 'UnmatchedReply', label: 'unmatched_replies' },
  { entity: 'AssistantConversation', label: 'assistant_conversations' },
];
const ALL_LABELS = ['bookings', ...CLIENT_ENTITIES.map((c) => c.label)];

type Move = { entity: string; id: string; patch: Record<string, any>; before: Record<string, any> };

/** Why these two records may not be merged, or null when they may. */
export function mergeRefusal(survivor: any, dup: any): string | null {
  if (!survivor || !dup) return 'One of those clients could not be found.';
  if (survivor.id === dup.id) return 'Pick two different clients.';
  if ((survivor.is_test === true) !== (dup.is_test === true)) {
    return 'A test client cannot be merged with a real one.';
  }
  const a = phoneKey(survivor.phone);
  const b = phoneKey(dup.phone);
  if (a && b && a !== b) {
    return 'These two records have different phone numbers, so they may be two different people. Correct the phone number on one of them first if they are the same person.';
  }
  return null;
}

/** The booking changes for a merge. Pure. */
export function planBookingMoves(bookings: any[], survivor: any, dup: any) {
  const moves: { id: string; patch: Record<string, any>; before: Record<string, any> }[] = [];
  let keptAsRecord = 0;
  let skippedUniverse = 0;
  for (const b of bookings) {
    // A test booking is never moved onto a real client, or the reverse.
    if ((b.is_test === true) !== (dup.is_test === true)) { skippedUniverse++; continue; }
    const patch: Record<string, any> = { client_id: survivor.id };
    if (FINISHED_STATUSES.includes(b.status)) {
      keptAsRecord++;
    } else {
      patch.client_name = survivor.client_name;
      if (survivor.phone) patch.phone = survivor.phone;
      if (survivor.email) patch.email = survivor.email;
    }
    const before: Record<string, any> = {};
    for (const k of Object.keys(patch)) before[k] = b[k] ?? null;
    moves.push({ id: b.id, patch, before });
  }
  return { moves, keptAsRecord, skippedUniverse };
}

/**
 * The whole merge plan across entities. Pure.
 * `rows` holds each entity's rows that point at the duplicate. `survivorCampaignKeys` are the
 * week|stage keys the survivor already has: a campaign entry is unique per client, week and
 * stage, so the duplicate's copy of one the survivor has is left and counted, never doubled.
 */
export function planClientMoves(
  rows: Record<string, any[]>, survivor: any, dup: any, survivorCampaignKeys: string[] = [],
) {
  const bookings = planBookingMoves(rows.BookingRequest || [], survivor, dup);
  const moves: Move[] = bookings.moves.map((m) => ({ entity: 'BookingRequest', ...m }));
  const counts: Record<string, number> = { bookings: bookings.moves.length };
  let skippedUniverse = bookings.skippedUniverse;
  let campaignLeftDuplicate = 0;
  const taken = new Set(survivorCampaignKeys);
  for (const { entity, label } of CLIENT_ENTITIES) {
    let n = 0;
    for (const r of rows[entity] || []) {
      // Test and real never mix. Most of these rows carry no flag; those follow their client.
      if (typeof r.is_test === 'boolean' && r.is_test !== (dup.is_test === true)) { skippedUniverse++; continue; }
      if (entity === 'CampaignEntry') {
        const key = `${r.campaign_week}|${r.stage}`;
        if (taken.has(key)) { campaignLeftDuplicate++; continue; }
        taken.add(key);
      }
      moves.push({ entity, id: r.id, patch: { client_id: survivor.id }, before: { client_id: dup.id } });
      n++;
    }
    counts[label] = n;
  }
  return { moves, counts, keptAsRecord: bookings.keptAsRecord, skippedUniverse, campaignLeftDuplicate };
}

const writeMoves = async (admin: any, moves: Move[], pick: (m: Move) => Record<string, any>) => {
  const byEntity = new Map<string, any[]>();
  for (const m of moves) byEntity.set(m.entity, [...(byEntity.get(m.entity) || []), { id: m.id, ...pick(m) }]);
  for (const [entity, list] of byEntity) {
    for (let i = 0; i < list.length; i += CHUNK) await admin.entities[entity].bulkUpdate(list.slice(i, i + CHUNK));
  }
};

/** Put every planned row back, entity by entity; one entity failing never stops the others. */
const restoreAll = async (admin: any, moves: Move[]) => {
  let ok = true;
  const entities = [...new Set(moves.map((m) => m.entity))].reverse();
  for (const e of entities) {
    try { await writeMoves(admin, moves.filter((m) => m.entity === e), (m) => m.before); } catch { ok = false; }
  }
  return ok;
};

const zeroCounts = () => Object.fromEntries(ALL_LABELS.map((l) => [`${l}_moved`, 0]));

export async function mergeClients(
  admin: any,
  { survivorId, duplicateId, who }: { survivorId: string; duplicateId: string; who: string },
): Promise<{ status: number; body: any }> {
  let survivor: any = null;
  let dup: any = null;
  try {
    [survivor, dup] = await Promise.all([
      admin.entities.ReminderClient.get(String(survivorId)),
      admin.entities.ReminderClient.get(String(duplicateId)),
    ]);
  } catch {
    return { status: 404, body: { merged: false, error: 'One of those clients could not be found.' } };
  }

  const refusal = mergeRefusal(survivor, dup);
  if (refusal) return { status: 409, body: { merged: false, error: refusal, code: 'MERGE_REFUSED' } };

  const rows: Record<string, any[]> = {};
  let sameName: any[];
  let survivorCampaign: any[];
  try {
    rows.BookingRequest = asRows(await admin.entities.BookingRequest.filter({ client_id: dup.id }, 'created_date', MAX_BOOKINGS + 1));
    for (const { entity } of CLIENT_ENTITIES) {
      rows[entity] = asRows(await admin.entities[entity].filter({ client_id: dup.id }, 'created_date', MAX_BOOKINGS + 1));
    }
    sameName = asRows(await admin.entities.BookingRequest.filter({ client_name: dup.client_name }, 'created_date', MAX_BOOKINGS));
    survivorCampaign = asRows(await admin.entities.CampaignEntry.filter({ client_id: survivor.id }, 'created_date', MAX_BOOKINGS));
  } catch {
    return { status: 503, body: { merged: false, error: 'The client\u2019s records could not be read, so nothing was changed. Please try again.' } };
  }
  if (Object.values(rows).some((list) => list.length > MAX_BOOKINGS)) {
    return { status: 409, body: { merged: false, error: `This client has more than ${MAX_BOOKINGS} records of one kind, which is too many to merge in one step.`, code: 'MERGE_REFUSED' } };
  }
  // Same name, no client id: reported, never touched. The name alone does not say who it is.
  const unlinked = sameName.filter((b) => !b.client_id && (b.is_test === true) === (dup.is_test === true)).length;

  const plan = planClientMoves(rows, survivor, dup, survivorCampaign.map((c) => `${c.campaign_week}|${c.stage}`));
  const entry = {
    action: 'clients_merged',
    who,
    summary: `${who} merged a duplicate client into another.`,
    ids: { survivor_client_id: survivor.id, duplicate_client_id: dup.id },
    related: { type: 'Client' as const, id: survivor.id },
  };

  // Recorded BEFORE anything changes; no record, no merge.
  const auditId = await recordAudit(admin, {
    ...entry, outcome: 'failed', note: 'Started, not yet finished.', counts: { records_to_move: plan.moves.length },
  });
  if (!auditId) return { status: 500, body: { merged: false, ...AUDIT_REFUSED } };

  const failed = async (message: string) => {
    const restored = await restoreAll(admin, plan.moves);
    await finishAudit(admin, auditId, {
      ...entry, outcome: 'failed', note: restored ? 'Failed; everything put back.' : 'Failed; some records could NOT be put back.',
      counts: zeroCounts(),
    });
    return restored
      ? { status: 500, body: { merged: false, error: `${message} Nothing was changed.` } }
      : { status: 500, body: { merged: false, inconsistent: true, error: `${message} Some records may still point at the other client. Contact support before trying again.` } };
  };

  try {
    await writeMoves(admin, plan.moves, (m) => m.patch);
  } catch {
    return failed('The client\u2019s records could not be moved.');
  }

  // The duplicate goes last. If the delete errors, ask whether it really survived. Only a
  // clean answer counts: gone means the merge is complete, still there means everything is
  // put back, and a read that itself fails means we do not know. That is never "deleted".
  let deleteFailed = false;
  try {
    await admin.entities.ReminderClient.delete(dup.id);
  } catch {
    deleteFailed = true;
  }
  if (deleteFailed) {
    let still: any = null;
    let unknown = false;
    try { still = await admin.entities.ReminderClient.get(dup.id); } catch { unknown = true; }
    if (unknown) {
      await finishAudit(admin, auditId, {
        ...entry, outcome: 'failed', note: 'Records moved, but whether the duplicate was removed could not be confirmed.', counts: zeroCounts(),
      });
      return { status: 500, body: { merged: false, inconsistent: true, error: 'The merge could not be confirmed. The records were moved but the other client may still exist. Contact support before trying again.' } };
    }
    if (still) return failed('The duplicate client could not be removed.');
  }

  const movedCounts = Object.fromEntries(ALL_LABELS.map((l) => [`${l}_moved`, plan.counts[l] || 0]));
  await finishAudit(admin, auditId, {
    ...entry,
    outcome: 'applied',
    counts: {
      ...movedCounts,
      bookings_kept_as_record: plan.keptAsRecord,
      bookings_without_client_id_left_alone: unlinked,
      skipped_test_mismatch: plan.skippedUniverse,
      campaign_entries_left_duplicate: plan.campaignLeftDuplicate,
    },
  });

  return {
    status: 200,
    body: {
      merged: true,
      bookings_moved: plan.counts.bookings,
      moved: movedCounts,
      bookings_kept_as_record: plan.keptAsRecord,
      bookings_without_client_id_left_alone: unlinked,
      bookings_skipped_test_mismatch: plan.skippedUniverse,
      campaign_entries_left_duplicate: plan.campaignLeftDuplicate,
    },
  };
}