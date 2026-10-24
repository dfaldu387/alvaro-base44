import { normaliseAuPhone } from './auPhone.ts';
import { sydneyNow } from './arrivalTimes.ts';
import { extractTimes, guardDraft, type GuardContext } from './assistantGuard.ts';
import { guardContextFor, type AssistantPack } from './assistantContext.ts';
import { CONSTRAINT_SCHEMA, constraintPrompt, normaliseConstraint, windowBounds, cap, type Constraint } from './assistantConstraint.ts';
import type { EnqueueInput, EnqueueResult } from './outboxEnqueue.ts';

/**
 * Free-text booking conversations.
 *
 * The model's ONLY job here is turning the customer's message into a constraint
 * (shared/assistantConstraint). Everything a customer is then shown or booked is
 * decided by code from what the scheduling engine returned in this conversation:
 *
 *   1. ask the engine (BookingDeps.search = the Route Flow candidate generator,
 *      validator, travel index and scoring) for valid times inside the customer's
 *      own window; offer at most MAX_OFFERS of exactly those;
 *   2. the offer text is built in code from the engine's labels, then checked by the
 *      same hard guard as every other message, with those slots as the allowed set;
 *   3. when the customer picks one, the slot is RE-VALIDATED against live data
 *      before anything is written (BookingDeps.revalidate = the validator and race
 *      check applyManualPlacement uses). A slot that has gone is never booked: the
 *      customer is told plainly and the engine is asked again;
 *   4. the booking is created only through the shared booking creator
 *      (BookingDeps.create), as `pending`, already placed and LOCKED so Route Flow
 *      cannot move the time the customer was just told.
 *
 * No holds: a collision for one barber is rare, and a hold would need an expiry
 * sweep and new state. Re-validation at acceptance is the guarantee instead.
 * This module has no database writes to BookingRequest of its own.
 */

/** Replies per phone per 24h for a conversation that is actively in a booking flow (one-off questions keep DAILY_REPLY_CAP). */
export const BOOKING_REPLY_CAP = 12;
/** An unanswered offer lapses after this long; the next reply silently gets a fresh search. */
export const OFFER_EXPIRY_HOURS = 24;
/** Never more than this many times in one offer. */
export const MAX_OFFERS = 3;

export interface SlotOption { label: string; start_decimal: number; date: string }

export interface StandIn { booking: any; body: any; address_source: 'client_record' | 'last_booking' }
export type StandInResult =
  | ({ ok: true } & StandIn)
  | { ok: false; code: 'no_history' | 'no_address' | 'no_contact' | 'no_coverage' | 'error'; reason: string };

/** What the live system provides; tests inject fakes. Each is a thin wrapper over a shared module. */
export interface BookingDeps {
  /** A booking-shaped record for the engine to test, built from the client's CURRENT address on record. */
  loadStandIn(admin: any, client: any, constraint: Constraint): Promise<StandInResult>;
  /** Engine search (slotSearch.findValidSlots). Returns valid slots in the engine's ranked order. */
  search(admin: any, standIn: StandIn, constraint: Constraint): Promise<{ slots: { label: string; start_decimal: number }[]; duration_minutes: number; reason: string | null }>;
  /** Engine re-validation (placementRevalidate.revalidatePlacement), source route_flow. */
  revalidate(admin: any, standIn: StandIn, date: string, start: number): Promise<{ ok: boolean; stage: string; label?: string; reason?: string }>;
  /** The shared booking creator (publicBookingCreate.createPublicBooking) with the assistant option. */
  create(admin: any, standIn: StandIn, assistant: { conversation_id: string; assigned_time: string }, token: string): Promise<{ ok: boolean; id?: string; reason?: string }>;
  /** Engine-valid alternative times for an EXISTING booking (reschedule options). Read-only. */
  searchExisting(admin: any, booking: any, constraint: Constraint | null): Promise<{ date: string; slots: { label: string; start_decimal: number }[]; duration_minutes: number }>;
}

type Done = (outcome: string, reason: string, patch?: Record<string, unknown>) => Promise<any>;
export interface TurnCtx {
  admin: any;
  sid: string;
  from: string;
  body: string;
  now: Date;
  client: any | null;
  mode: 'draft' | 'live';
  pack: AssistantPack;
  convo: any | null;
  bookingLink: string | null;
  booking: BookingDeps;
  enqueue: (admin: any, input: EnqueueInput) => Promise<EnqueueResult>;
  ask: (prompt: string, schema: Record<string, unknown>) => Promise<any>;
  done: Done;
}

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (ymd: string) => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
export const dateLabel = (ymd: string) => `${weekdayOf(ymd)} ${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
const minutesOf = (dec: number) => Math.round(dec * 60);

// ── Code-built customer text (the model never writes any of it) ──────────────────────
const hello = (first: string | null) => (first ? `Hi ${first}, ` : 'Hi, ');

export function offerText(first: string | null, date: string, slots: SlotOption[], apology: boolean): string {
  const list = slots.map((s, i) => `${i + 1}) ${s.label}`).join('  ');
  const reply = slots.length === 1 ? 'Reply 1 to pencil it in' : `Reply ${slots.map((_, i) => i + 1).join(', ').replace(/, (\d)$/, ' or $1')} to pencil one in`;
  const lead = apology ? 'sorry, that time has just gone. Here' : 'here';
  return `${hello(first)}${lead} is what is free on ${dateLabel(date)}: ${list}. ${reply}, or tell us what suits you better.`;
}

export function pencilledText(first: string | null, slot: SlotOption): string {
  return `${hello(first)}you are pencilled in for ${dateLabel(slot.date)} at ${slot.label}. Alvaro will confirm it with you shortly.`;
}

export function linkText(first: string | null, link: string): string {
  return `${hello(first)}you can see Alvaro's open times and book here: ${link}`;
}

// ── Reading the customer's pick: code only, never the model ─────────────────────────
const ORDINALS: Record<string, number> = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3 };
const DECLINE = /^(?:no|nope|nah|none|neither|none of (?:those|them)|no thanks|not really|no thank you)\b/i;

/** The 0-based option the customer picked, 'decline', or null when it is not clear. */
export function parseSelection(body: string, slots: SlotOption[]): number | 'decline' | null {
  const t = String(body || '').trim().toLowerCase();
  if (!t || !slots.length) return null;
  if (DECLINE.test(t)) return 'decline';
  const digit = t.match(/^(?:option|number|no\.?|#)?\s*([1-9])\s*[.)!]*$/);
  if (digit) { const i = Number(digit[1]) - 1; return i < slots.length ? i : null; }
  const word = t.match(/^(?:the\s+|option\s+|number\s+)?(first|second|third|1st|2nd|3rd|one|two|three)(?:\s+one|\s+option)?\s*[.!]*$/);
  if (word) { const i = ORDINALS[word[1]] - 1; return i < slots.length ? i : null; }
  const said = extractTimes(t).filter(f => f.minutes);
  if (said.length === 1) {
    const hits = slots.map((s, i) => (said[0].minutes!.includes(minutesOf(s.start_decimal)) ? i : -1)).filter(i => i >= 0);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

// ── Conversation record ──────────────────────────────────────────────────────────────
export async function loadActiveConversation(admin: any, clientId: string): Promise<any | null> {
  const rows = asList(await admin.entities.AssistantConversation.filter({ client_id: clientId, status: { $in: ['offered', 'drafting'] } }, '-created_date', 1));
  return rows[0] || null;
}

async function save(t: TurnCtx, patch: Record<string, unknown>, step?: [string, string]) {
  const prior = t.convo?.log || [];
  const log = step ? [...prior, { at: t.now.toISOString(), step: step[0], detail: step[1] }] : prior;
  const turns = (Number(t.convo?.turns) || 0) + (t.convo?.__counted ? 0 : 1);
  if (t.convo?.id) {
    const data = { ...patch, log, ...(t.convo.__counted ? {} : { turns }) };
    await t.admin.entities.AssistantConversation.update(t.convo.id, data);
    t.convo = { ...t.convo, ...data, __counted: true };
  } else {
    const created = await t.admin.entities.AssistantConversation.create({
      client_id: t.client.id, from_phone: normaliseAuPhone(t.from) || '', status: 'offered', turns: 1, ...patch, log,
    });
    t.convo = { ...created, __counted: true };
  }
}

/** The guard context for a booking-flow message: the pack's own facts plus ONLY these engine slots and days. */
export function guardContextWith(pack: AssistantPack, now: Date, slots: SlotOption[]): GuardContext {
  const base = guardContextFor(pack, now);
  return {
    ...base,
    allowedMinutes: [...base.allowedMinutes, ...slots.map(s => minutesOf(s.start_decimal))],
    days: { ...base.days, weekdays: [...base.days.weekdays, ...slots.map(s => weekdayOf(s.date).toLowerCase())] },
  };
}

/** Guard, then deliver by mode: draft waits for a tap, live queues through the outbox. */
async function deliver(t: TurnCtx, text: string, slots: SlotOption[], outcomeNote: string, extra: Record<string, unknown> = {}) {
  const verdict = guardDraft(text, guardContextWith(t.pack, t.now, slots));
  if (!verdict.ok) {
    await save(t, { status: 'escalated' }, ['guard', `The message was stopped by the guard: ${verdict.reasons.join('; ')}`]);
    return t.done('stopped', `The guard stopped the message: ${verdict.reasons.join('; ')}.`,
      { draft_text: text, draft_status: 'discarded', guard_fired: true, guard_reasons: verdict.reasons, conversation_id: t.convo?.id });
  }
  const allowed = { conversation_id: t.convo?.id, allowed_minutes: slots.map(s => minutesOf(s.start_decimal)), allowed_weekdays: [...new Set(slots.map(s => weekdayOf(s.date).toLowerCase()))] };
  if (t.mode === 'draft') {
    return t.done('drafted', `${outcomeNote} Draft ready for you to send.`, { draft_text: text, draft_status: 'pending', ...allowed, ...extra });
  }
  const to = normaliseAuPhone(t.from)!;
  const queued = await t.enqueue(t.admin, {
    channel: 'sms', to_address: to, template_key: 'assistant_reply', payload: { text },
    client_id: t.client.id, booking_request_id: (extra.booking_request_id as string) || undefined, idempotency_key: `sms|${t.client.id}|assistant_${t.sid}`,
  });
  if (!queued.ok) return t.done('escalated', `${outcomeNote} The message could not be queued: ${queued.error}`, { draft_text: text, draft_status: 'pending', ...allowed, ...extra });
  return t.done('queued', `${outcomeNote} Sent automatically (live mode).`, {
    draft_text: text, draft_status: 'sent', sent_by: 'assistant', sent_at: t.now.toISOString(), send_kind: 'automated', outbox_id: queued.message_outbox?.id, ...allowed, ...extra,
  });
}

async function escalate(t: TurnCtx, reason: string, step: string) {
  if (t.convo?.id || t.client) await save(t, { status: 'escalated' }, ['escalated', step]);
  return t.done('escalated', reason, { conversation_id: t.convo?.id });
}

/** Offer the booking link. Used for strangers (drafted for Alvaro to copy) and known clients with nothing to build a booking from. */
async function sendLink(t: TurnCtx, why: string) {
  if (!t.bookingLink) return t.done('escalated', `${why} There is no booking link set in Messaging settings to send instead.`);
  const text = linkText(t.pack.first_name, t.bookingLink);
  const verdict = guardDraft(text, guardContextWith(t.pack, t.now, []));
  if (!verdict.ok) return t.done('escalated', `${why} The booking-link message was stopped by the guard.`);
  if (!t.client) {
    return t.done('escalated', `${why} New number with no client record, so a reply cannot be sent from here. The booking link is attached to copy.`, { draft_text: text, draft_status: 'pending' });
  }
  if (t.mode === 'draft') return t.done('drafted', `${why} Booking link ready for you to send.`, { draft_text: text, draft_status: 'pending' });
  const queued = await t.enqueue(t.admin, {
    channel: 'sms', to_address: normaliseAuPhone(t.from)!, template_key: 'assistant_reply', payload: { text },
    client_id: t.client.id, idempotency_key: `sms|${t.client.id}|assistant_${t.sid}`,
  });
  if (!queued.ok) return t.done('escalated', `${why} The booking link could not be queued: ${queued.error}`, { draft_text: text, draft_status: 'pending' });
  return t.done('queued', `${why} Booking link sent automatically (live mode).`, {
    draft_text: text, draft_status: 'sent', sent_by: 'assistant', sent_at: t.now.toISOString(), send_kind: 'automated', outbox_id: queued.message_outbox?.id,
  });
}

/** Ask the engine inside the customer's window and offer at most MAX_OFFERS of what it returns. */
async function searchAndOffer(t: TurnCtx, constraint: Constraint, apology: boolean) {
  if (constraint.date <= sydneyNow(t.now).date) {
    return escalate(t, 'The day the customer asked for has passed, so a person should pick this up.', 'The requested day has passed.');
  }
  const stand = await t.booking.loadStandIn(t.admin, t.client, constraint);
  if (!stand.ok) {
    if (stand.code === 'no_history' || stand.code === 'no_address' || stand.code === 'no_contact') {
      await save(t, { status: 'closed', constraint }, ['link', stand.reason]);
      return sendLink(t, stand.reason);
    }
    return escalate(t, stand.reason, stand.reason);
  }
  const found = await t.booking.search(t.admin, stand, constraint);
  const bounds = windowBounds(constraint);
  const eps = 1e-6;
  const seen = new Set<number>();
  const picked: SlotOption[] = [];
  // Engine order is its ranking; keep the best MAX_OFFERS that are inside the customer's own window.
  for (const s of found.slots) {
    const inside = s.start_decimal >= bounds.start - eps && s.start_decimal + found.duration_minutes / 60 <= bounds.end + eps;
    const key = minutesOf(s.start_decimal);
    if (!inside || seen.has(key)) continue;
    seen.add(key);
    picked.push({ label: s.label, start_decimal: s.start_decimal, date: constraint.date });
    if (picked.length >= MAX_OFFERS) break;
  }
  picked.sort((a, b) => a.start_decimal - b.start_decimal);
  await save(t, { constraint, address_source: stand.address_source }, ['search',
    `Engine returned ${found.slots.length} valid time(s) for ${dateLabel(constraint.date)}; ${picked.length} inside the customer's window. Address source: ${stand.address_source}.`]);
  if (!picked.length) {
    const why = found.reason || 'no valid time fitted';
    return escalate(t, `The scheduling engine found no valid time on ${dateLabel(constraint.date)} inside what the customer asked for (${why}). Nothing was offered.`, `No valid time. Engine reason: ${why}.`);
  }
  const text = offerText(t.pack.first_name, constraint.date, picked, apology);
  await save(t, { status: t.mode === 'draft' ? 'drafting' : 'offered', offered_slots: picked, ...(t.mode === 'live' ? { offered_at: t.now.toISOString() } : {}) },
    ['offered', `Offered ${picked.map(s => s.label).join(', ')}${t.mode === 'draft' ? ' (waiting for Alvaro to send)' : ''}.`]);
  return deliver(t, text, picked, 'Times offered from the scheduling engine.');
}

async function accept(t: TurnCtx, slot: SlotOption) {
  const constraint = t.convo.constraint as Constraint;
  await save(t, { accepted_slot: slot }, ['accepted', `Customer picked ${slot.label} on ${dateLabel(slot.date)}.`]);
  const stand = await t.booking.loadStandIn(t.admin, t.client, constraint);
  if (!stand.ok) return escalate(t, `The customer picked a time but the booking could not be prepared: ${stand.reason}`, stand.reason);
  const check = await t.booking.revalidate(t.admin, stand, slot.date, slot.start_decimal);
  await save(t, {}, ['revalidated', check.ok ? 'Slot still valid at the moment of acceptance.' : `Slot no longer valid (${check.stage}${check.reason ? `: ${check.reason}` : ''}). Nothing was booked.`]);
  if (!check.ok) return searchAndOffer(t, constraint, true);

  const token = `asst-${t.convo.id}-${slot.date}-${minutesOf(slot.start_decimal)}`.slice(0, 64);
  const made = await t.booking.create(t.admin, stand, { conversation_id: t.convo.id, assigned_time: check.label || slot.label }, token);
  if (!made.ok || !made.id) {
    return escalate(t, `The customer picked ${slot.label}, but the booking was not created${made.reason ? ` (${made.reason})` : ''}. Nothing was promised.`, `Booking not created${made.reason ? `: ${made.reason}` : ''}.`);
  }
  await save(t, { status: 'booked', booking_request_id: made.id }, ['booked', `Booking ${made.id} created as pending, locked at ${check.label || slot.label}.`]);
  return deliver(t, pencilledText(t.pack.first_name, slot), [slot], 'Booking created as pending and the customer was told it is pencilled in.', { booking_request_id: made.id });
}

/** Does this time-old offer still count? */
const lapsed = (convo: any, now: Date) => !convo?.offered_at || now.getTime() - new Date(convo.offered_at).getTime() > OFFER_EXPIRY_HOURS * 3600_000;

export async function handleBookingTurn(t: TurnCtx): Promise<any> {
  // A stranger is never booked: they get the booking link (drafted for Alvaro to copy).
  if (!t.client) return sendLink(t, 'Asks about times, but this number has no client record.');

  const convo = t.convo;
  if (convo?.status === 'offered' && Array.isArray(convo.offered_slots) && convo.offered_slots.length) {
    if (lapsed(convo, t.now)) {
      // Silent re-search from the constraint already parsed: no model call, no mention of expiry.
      await save(t, {}, ['reoffer', 'The earlier offer lapsed; searching again from the stored request.']);
      return searchAndOffer(t, convo.constraint as Constraint, false);
    }
    const pick = parseSelection(t.body, convo.offered_slots);
    if (typeof pick === 'number') return accept(t, convo.offered_slots[pick]);
    if (pick === 'decline') {
      return escalate(t, 'The customer turned down the times offered, so this is left for you.', 'Customer declined the offer.');
    }
  } else if (convo) {
    // An unsent draft offer is replaced by whatever the customer says now.
    await t.admin.entities.AssistantConversation.update(convo.id, { status: 'closed' });
    t.convo = null;
  }

  let parsed;
  try {
    parsed = normaliseConstraint(await t.ask(constraintPrompt(t.body, sydneyNow(t.now).date), CONSTRAINT_SCHEMA), t.now);
  } catch (e) {
    console.error('assistant constraint failed', (e as Error)?.message);
    return escalate(t, 'The assistant could not read the request, so it is left for you.', 'The model call failed.');
  }
  if (!parsed.ok) return escalate(t, parsed.reason, parsed.reason);
  await save(t, { constraint: parsed.constraint }, ['constraint',
    `Parsed: ${dateLabel(parsed.constraint.date)}${parsed.constraint.earliest ? `, from ${parsed.constraint.earliest}` : ''}${parsed.constraint.latest ? `, until ${parsed.constraint.latest}` : ''} (confidence ${Math.round(parsed.constraint.confidence * 100)}%).`]);
  return searchAndOffer(t, parsed.constraint, false);
}

/** Reschedule help: engine-valid alternatives for an existing booking, attached to the request. Never changes the booking. */
export async function rescheduleOptions(
  admin: any, deps: BookingDeps, booking: any, ask: TurnCtx['ask'], body: string, now: Date,
): Promise<SlotOption[]> {
  try {
    let constraint: Constraint | null = null;
    try {
      const parsed = normaliseConstraint(await ask(constraintPrompt(body, sydneyNow(now).date), CONSTRAINT_SCHEMA), now);
      constraint = parsed.ok ? parsed.constraint : null;
    } catch { constraint = null; }
    const found = await deps.searchExisting(admin, booking, constraint);
    const bounds = constraint ? windowBounds(constraint) : { start: 0, end: 24 };
    const own = booking.assigned_time ? extractTimes(String(booking.assigned_time)).find(f => f.minutes)?.minutes?.[0] : undefined;
    const out: SlotOption[] = [];
    for (const s of found.slots) {
      const inside = s.start_decimal >= bounds.start - 1e-6 && s.start_decimal + found.duration_minutes / 60 <= bounds.end + 1e-6;
      if (!inside || (found.date === booking.requested_date && own === minutesOf(s.start_decimal))) continue;
      out.push({ label: s.label, start_decimal: s.start_decimal, date: found.date });
      if (out.length >= MAX_OFFERS) break;
    }
    return out.sort((a, b) => a.start_decimal - b.start_decimal);
  } catch (e) {
    console.error('assistant reschedule options failed', (e as Error)?.message);
    return [];
  }
}

export { cap };