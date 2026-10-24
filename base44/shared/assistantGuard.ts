/**
 * The assistant's hard guard. PURE: no database, no model, no network.
 *
 * A draft may reach a customer (or even Alvaro's screen as a sendable draft)
 * only if every time, price and day it states was supplied by the system:
 *   - times must be in the set the scheduling data produced for this conversation
 *     (the booked time that was communicated, and the customer's own window);
 *   - prices must equal a real service / add-on / booking price;
 *   - weekdays and "today"/"tomorrow" must match the booking's date.
 * Anything time-like that cannot be checked ("tomorrow morning", "in 20 minutes",
 * "around lunchtime") is refused outright: it can never be in the allowed set.
 *
 * This is code, not a prompt instruction. It fails closed: when in doubt the
 * draft is discarded and the conversation is escalated.
 */

export type TimeFinding = { raw: string; minutes: number[] | null };

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const WORDS = Object.keys(WORD_NUM).join('|');
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Candidate minutes-of-day for an hour/minute and optional am/pm. Without am/pm both readings are kept. */
function candidates(h: number, m: number, mer?: string): number[] | null {
  if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59) return null;
  if (mer === 'am' || mer === 'pm') {
    if (h < 1 || h > 12) return null;
    return [((h % 12) + (mer === 'pm' ? 12 : 0)) * 60 + m];
  }
  if (h === 0 || h === 24) return [m];
  if (h < 0 || h > 24) return null;
  if (h > 12) return [h * 60 + m];
  return [h * 60 + m, ((h % 12) + 12) * 60 + m];
}

function normalise(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/\b([ap])\.m\./g, '$1m')
    .replace(/\u2013|\u2014/g, '-');
}

/** Every time-like phrase in the text. minutes === null means "cannot be validated". */
export function extractTimes(input: string): TimeFinding[] {
  let t = normalise(input);
  const found: TimeFinding[] = [];
  const take = (re: RegExp, build: (m: RegExpExecArray) => number[] | null, skip?: (m: RegExpExecArray, s: string) => boolean) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const spans: [number, number][] = [];
    while ((m = re.exec(t))) {
      if (skip && skip(m, t)) continue;
      found.push({ raw: m[0].trim(), minutes: build(m) });
      spans.push([m.index, m.index + m[0].length]);
    }
    // Blank what was consumed so a later pattern does not count it twice.
    for (const [a, b] of spans) t = t.slice(0, a) + ' '.repeat(b - a) + t.slice(b);
  };
  const isMoney = (m: RegExpExecArray, s: string) =>
    s[m.index - 1] === '$' || /^\s*(dollars|bucks|aud)\b/.test(s.slice(m.index + m[0].length));

  // 10:45am, 4.30pm, 16:00, 4:30
  take(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?(?!\d)/g, m => candidates(Number(m[1]), Number(m[2]), m[3]), isMoney);
  // 4pm, 10 am
  take(/\b(\d{1,2})\s*(am|pm)\b/g, m => candidates(Number(m[1]), 0, m[2]));
  // 4 o'clock, four o'clock
  take(/\b(\d{1,2})\s*o'?clock\b/g, m => candidates(Number(m[1]), 0));
  take(new RegExp(`\\b(${WORDS})\\s+o'?clock\\b`, 'g'), m => candidates(WORD_NUM[m[1]], 0));
  // half four, half past 4, quarter past four, quarter to five
  take(new RegExp(`\\b(half|quarter)\\s+(past|to|after|before)?\\s*(${WORDS}|\\d{1,2})\\b`, 'g'), m => {
    const h = WORD_NUM[m[3]] ?? Number(m[3]);
    if (m[1] === 'half') return candidates(h, 30);
    if (m[2] === 'to' || m[2] === 'before') return candidates(((h + 10) % 12) + 1, 45);
    return candidates(h, 15);
  });
  // four thirty, four-fifteen, four forty-five
  take(new RegExp(`\\b(${WORDS})[ -](thirty|fifteen|forty[ -]?five)\\b`, 'g'), m =>
    candidates(WORD_NUM[m[1]], m[2] === 'thirty' ? 30 : m[2] === 'fifteen' ? 15 : 45));
  // 1630hrs, at 1630
  take(/\b(?:at|by|from|around)\s+([01]\d|2[0-3])([0-5]\d)\b/g, m => candidates(Number(m[1]), Number(m[2])));
  take(/\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs|hours|h)\b/g, m => candidates(Number(m[1]), Number(m[2])));
  // "at 4", "around 5", "after 3", "between 2 and 4" (numbers that are not durations, counts or prices)
  take(
    /\b(?:at|around|by|from|until|till|before|after|between)\s+(\d{1,2})\b(?!\s*(?:%|km|min|mins|minutes?|hours?|hrs?|days?|weeks?|people|persons?|cuts?|st\b|nd\b|rd\b|th\b|dollars|bucks))/g,
    m => candidates(Number(m[1]), 0),
    (m, s) => s[m.index + m[0].length] === '.' && /\d/.test(s[m.index + m[0].length + 1] || ''),
  );
  take(new RegExp(`\\b(?:at|around|from|until|till)\\s+(${WORDS})\\b`, 'g'), m => candidates(WORD_NUM[m[1]], 0));
  // Relative promises: "in 20 minutes", "within an hour", "another half hour"
  take(
    new RegExp(`\\b(?:in|within|another)\\s+(?:about\\s+|around\\s+)?(?:\\d+|an?|a couple of|a few|couple of|few|half an?|${WORDS})\\s*(?:mins?|minutes?|hours?|hrs?)\\b`, 'g'),
    () => null,
  );
  take(/\b\d+\s*(?:mins?|minutes?)\s+(?:away|late|from now)\b/g, () => null);
  // Day parts and fuzzy times can never be in the allowed set.
  take(/\b(noon|midday|midnight|morning|afternoon|evening|tonight|lunch ?time|first thing|end of (?:the )?day|after work|sunrise|sunset|dawn|dusk)\b/g, () => null);

  return found;
}

export interface TimeVerdict { ok: boolean; violations: string[] }

/** Allowed times are minutes-of-day. A finding passes when any of its readings is allowed. */
export function checkTimes(text: string, allowed: Iterable<number>): TimeVerdict {
  const ok = new Set(allowed);
  const violations: string[] = [];
  for (const f of extractTimes(text)) {
    if (f.minutes === null) violations.push(`"${f.raw}" is a time phrase that cannot be checked against the schedule`);
    else if (!f.minutes.some(m => ok.has(m))) violations.push(`"${f.raw}" is not a time the scheduling data returned`);
  }
  return { ok: violations.length === 0, violations };
}

/** Dollar amounts in the text. */
export function extractPrices(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  const t = normalise(text);
  for (const m of t.matchAll(/\$\s?(\d{1,4}(?:\.\d{1,2})?)/g)) out.push({ raw: m[0], value: Number(m[1]) });
  for (const m of t.matchAll(/\b(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars|bucks|aud)\b/g)) out.push({ raw: m[0], value: Number(m[1]) });
  return out;
}

export function checkPrices(text: string, allowed: Iterable<number>): TimeVerdict {
  const ok = [...allowed].filter(n => Number.isFinite(n));
  const violations: string[] = [];
  for (const p of extractPrices(text)) {
    if (!ok.some(a => Math.abs(a - p.value) < 0.005)) violations.push(`${p.raw} is not a real service price`);
  }
  return { ok: violations.length === 0, violations };
}

export interface DayRules {
  /** Lower-case weekday names the booking's date allows. Empty = no weekday may be named. */
  weekdays: string[];
  /** True when the booking is today / tomorrow in Sydney. */
  isToday: boolean;
  isTomorrow: boolean;
}

export function checkDays(text: string, rules: DayRules): TimeVerdict {
  const t = normalise(text);
  const violations: string[] = [];
  for (const d of WEEKDAYS) {
    if (new RegExp(`\\b${d}s?\\b`).test(t) && !rules.weekdays.includes(d)) violations.push(`"${d}" is not the day of this booking`);
  }
  if (/\btomorrow\b/.test(t) && !rules.isTomorrow) violations.push('"tomorrow" is not the day of this booking');
  if (/\btoday\b/.test(t) && !rules.isToday) violations.push('"today" is not the day of this booking');
  return { ok: violations.length === 0, violations };
}

export interface GuardContext {
  allowedMinutes: Iterable<number>;
  allowedPrices: Iterable<number>;
  days: DayRules;
  maxLength?: number;
}

export interface GuardResult { ok: boolean; reasons: string[]; codes: string[] }

export const MAX_DRAFT_LENGTH = 320;

/** The single entry point: every draft, acknowledgement and tapped send goes through this. */
export function guardDraft(text: unknown, ctx: GuardContext): GuardResult {
  const reasons: string[] = [];
  const codes: string[] = [];
  const add = (code: string, list: string[]) => { if (list.length) { codes.push(code); reasons.push(...list); } };

  const s = typeof text === 'string' ? text.trim() : '';
  if (!s) add('empty', ['The draft is empty']);
  if (s.length > (ctx.maxLength ?? MAX_DRAFT_LENGTH)) add('too_long', [`The draft is longer than ${ctx.maxLength ?? MAX_DRAFT_LENGTH} characters`]);
  if (/\{\{|\}\}/.test(s)) add('placeholder', ['The draft contains an unfilled placeholder']);
  if (s) {
    add('time', checkTimes(s, ctx.allowedMinutes).violations);
    add('price', checkPrices(s, ctx.allowedPrices).violations);
    add('day', checkDays(s, ctx.days).violations);
  }
  return { ok: reasons.length === 0, reasons, codes };
}

/** "10:45am" / "10:45 AM" / "4pm" / 16:00 -> minutes-of-day, or null. Used to read stored booking times. */
export function minutesFromStored(value: unknown): number | null {
  const found = extractTimes(String(value ?? ''));
  const first = found.find(f => f.minutes && f.minutes.length > 0);
  return first && first.minutes ? first.minutes[0] : null;
}