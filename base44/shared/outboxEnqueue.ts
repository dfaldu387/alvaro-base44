/**
 * The ONE place a message is put on the MessageOutbox. Used by the
 * enqueueMessage endpoint and by server-side transitions (public booking
 * submission, confirmBooking, route finalisation). It ONLY enqueues: nothing is
 * rendered, sent or delivered here — the sweep does that, with every protection.
 *
 * Idempotency: one idempotency_key = one row. The entity layer has no unique
 * constraint, so every caller creates its row, then reads every row carrying the
 * key; the OLDEST (created_date, then id) is the single survivor and any other
 * row is deleted by the caller that made it.
 */

import { byAge } from './outboxCanonical.ts';

const CHANNELS = ['sms', 'whatsapp', 'email'];

export interface EnqueueInput {
  channel?: string;
  to_address?: string;
  template_key?: string;
  payload?: Record<string, unknown> | null;
  booking_request_id?: string;
  client_id?: string;
  message_id?: string;
  idempotency_key?: string;
  manual?: boolean;
}

export type EnqueueResult =
  | { ok: true; created: boolean; message_outbox: any }
  | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): EnqueueResult => ({ ok: false, status, code, error });
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const isBlank = (v: any) => typeof v !== 'string' || v.trim() === '';



async function readLinked(admin: any, entity: string, id: string) {
  try {
    const record = await admin.entities[entity].get(id);
    return { found: !!record, record: record || null };
  } catch {
    return { found: false, record: null };
  }
}

export async function enqueueOutboxMessage(admin: any, input: EnqueueInput): Promise<EnqueueResult> {
  const { channel, to_address, template_key, payload, booking_request_id, client_id, message_id, idempotency_key, manual } = input || {};

  if (!channel || !CHANNELS.includes(channel)) {
    return fail(400, 'INVALID_CHANNEL', 'channel must be one of: sms, whatsapp, email.');
  }
  if (isBlank(to_address)) return fail(400, 'INVALID_INPUT', 'to_address is required.');
  const to = String(to_address).trim();
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return fail(400, 'INVALID_INPUT', 'to_address is not a valid email address.');
  }
  if (channel !== 'email' && !/^\+?[0-9][0-9\s\-()]{5,}$/.test(to)) {
    return fail(400, 'INVALID_INPUT', 'to_address is not a valid phone number.');
  }
  if (isBlank(template_key)) return fail(400, 'INVALID_INPUT', 'template_key is required.');
  if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
    return fail(400, 'INVALID_INPUT', 'payload must be an object.');
  }
  if (isBlank(idempotency_key)) return fail(400, 'INVALID_INPUT', 'idempotency_key is required.');
  const key = String(idempotency_key);
  const keyParts = key.split('|');
  // channel|target_id|event_type, or channel|target_id|event_type|date for per-day events.
  if (keyParts.length < 3 || keyParts.length > 4 || keyParts.some(p => p.trim() === '') || keyParts[0] !== channel) {
    return fail(400, 'INVALID_INPUT', 'idempotency_key must be channel|target_id|event_type[|date] and start with the channel.');
  }
  for (const [name, v] of [['booking_request_id', booking_request_id], ['client_id', client_id], ['message_id', message_id]]) {
    if (v !== undefined && v !== null && isBlank(v)) {
      return fail(400, 'INVALID_INPUT', `${name} must be a non-empty string when provided.`);
    }
  }
  if (!booking_request_id && !client_id) {
    return fail(400, 'INVALID_INPUT', 'booking_request_id or client_id is required so test data can be identified.');
  }

  // Existing row wins: return it untouched.
  const existing = asList(await admin.entities.MessageOutbox.filter({ idempotency_key: key }, 'created_date', 20));
  if (existing.length > 0) {
    return { ok: true, created: false, message_outbox: [...existing].sort(byAge)[0] };
  }

  // Verify every linked record; unverifiable = fail safely.
  let isTest = false;
  if (booking_request_id) {
    const r = await readLinked(admin, 'BookingRequest', booking_request_id);
    if (!r.found) return fail(422, 'LINKED_RECORD_UNVERIFIED', 'The linked booking request could not be verified.');
    if (r.record.is_test === true) isTest = true;
  }
  if (client_id) {
    const r = await readLinked(admin, 'ReminderClient', client_id);
    if (!r.found) return fail(422, 'LINKED_RECORD_UNVERIFIED', 'The linked client could not be verified.');
    if (r.record.is_test === true) isTest = true;
  }
  if (message_id) {
    const r = await readLinked(admin, 'Message', message_id);
    if (!r.found) return fail(422, 'LINKED_RECORD_UNVERIFIED', 'The linked message could not be verified.');
  }

  const mine = await admin.entities.MessageOutbox.create({
    idempotency_key: key,
    channel,
    to_address: to,
    template_key: String(template_key).trim(),
    payload: payload || {},
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
    booking_request_id: booking_request_id || undefined,
    client_id: client_id || undefined,
    message_id: message_id || undefined,
    is_test: isTest,
    is_manual: manual === true,
  });

  // Let a simultaneous writer's row become visible before deciding who stays.
  await new Promise(resolve => setTimeout(resolve, 400));
  const rows = asList(await admin.entities.MessageOutbox.filter({ idempotency_key: key }, 'created_date', 20));
  const survivor = rows.length ? [...rows].sort(byAge)[0] : mine;

  if (survivor.id !== mine.id) {
    try { await admin.entities.MessageOutbox.delete(mine.id); } catch { /* survivor is still the only live row */ }
    return { ok: true, created: false, message_outbox: survivor };
  }
  return { ok: true, created: true, message_outbox: mine };
}