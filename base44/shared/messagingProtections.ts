/**
 * Customer-messaging protections shared by the inbound SMS webhook, the sweep
 * and the booking submit: reply keywords, Sydney quiet hours, and phone lookups.
 * New file — no scheduling core is touched.
 */
import { normaliseAuPhone, auPhoneSearchPattern } from './auPhone.ts';

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

// ── Reply keywords ───────────────────────────────────────────────────────────
// CANCEL is deliberately NOT here: it means "cancel my booking", which flags the
// booking for a human (arrivalReplies.ts). Messaging opt-out is STOP-type words only.
export const OPT_OUT_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'END', 'QUIT'];
export const OPT_IN_KEYWORDS = ['START', 'UNSTOP'];
export type ReplyKind = 'opt_out' | 'opt_in' | 'other';

/** Whole message, trimmed and case-insensitive. "please stop" is NOT a keyword. */
export function classifyReply(body: unknown): ReplyKind {
  const t = typeof body === 'string' ? body.trim().toUpperCase() : '';
  if (OPT_OUT_KEYWORDS.includes(t)) return 'opt_out';
  if (OPT_IN_KEYWORDS.includes(t)) return 'opt_in';
  return 'other';
}

// ── Quiet hours: nothing automated goes out outside 08:00–20:00 Sydney ───────
export const QUIET_TZ = 'Australia/Sydney';
export const QUIET_OPENS_HOUR = 8;
export const QUIET_CLOSES_HOUR = 20;

const formatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: QUIET_TZ, hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

function sydneyParts(ms: number) {
  const p: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return p;
}

function offsetMs(ms: number): number {
  const p = sydneyParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** The instant at which Sydney's wall clock reads y-m-d h:00 (DST-safe for 08:00). */
function sydneyWallToUtc(y: number, m: number, d: number, h: number): number {
  const guess = Date.UTC(y, m - 1, d, h);
  const first = guess - offsetMs(guess);
  return guess - offsetMs(first);
}

export type QuietVerdict = { quiet: false } | { quiet: true; resumeAt: string; sydneyHour: number };

export function quietHoursCheck(now: Date = new Date()): QuietVerdict {
  const p = sydneyParts(now.getTime());
  if (p.hour >= QUIET_OPENS_HOUR && p.hour < QUIET_CLOSES_HOUR) return { quiet: false };
  const dayOffset = p.hour >= QUIET_CLOSES_HOUR ? 1 : 0;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  const resume = sydneyWallToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), QUIET_OPENS_HOUR);
  return { quiet: true, resumeAt: new Date(resume).toISOString(), sydneyHour: p.hour };
}

// ── Finding people by phone ──────────────────────────────────────────────────
/** Every ReminderClient (real or test) whose stored phone normalises to the same number. */
export async function findClientsByPhone(admin: any, raw: unknown): Promise<any[]> {
  const key = normaliseAuPhone(raw);
  if (!key) return [];
  const rows = asList(await admin.entities.ReminderClient.filter(
    { phone: { $regex: auPhoneSearchPattern(key) } }, 'created_date', 50,
  ));
  return rows.filter((c: any) => normaliseAuPhone(c.phone) === key);
}

/** Pending outbox rows addressed to this number, however it was typed when queued. */
export async function findPendingOutboxByPhone(admin: any, raw: unknown): Promise<any[]> {
  const key = normaliseAuPhone(raw);
  if (!key) return [];
  const rows = asList(await admin.entities.MessageOutbox.filter(
    { status: 'pending', to_address: { $regex: auPhoneSearchPattern(key) } }, 'created_date', 200,
  ));
  return rows.filter((r: any) => normaliseAuPhone(r.to_address) === key);
}