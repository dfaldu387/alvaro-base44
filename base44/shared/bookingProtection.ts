import { normaliseAuPhone, normaliseEmail } from './auPhone.ts';
import { isTestLastName } from './testData.ts';

/**
 * Public-booking protection. Pure rules plus one read-only signal gatherer.
 *
 * The guiding rule: when something looks wrong a person sees it. Nothing here
 * rejects or drops a booking. `evaluateProtection` only ever says "hold for
 * review" and gives every reason in plain language.
 *
 * Limits come from the BookingProtectionRules record. These defaults are only
 * the starting values used until an admin saves a record.
 */
export const PROTECTION_DEFAULTS = {
  enabled: true,
  max_per_phone_hour: 10,
  max_per_email_hour: 10,
  max_per_ip_hour: 20,
  max_active_unconfirmed: 3,
  max_names_per_phone_day: 5,
  flag_outer_tier: true,
  repeat_declined_hours: 24,
  late_cancel_hours: 24,
};
export type ProtectionRules = typeof PROTECTION_DEFAULTS;

/** Saved record over the defaults. Numbers must be >= 0; 0 switches a check off. */
export function resolveProtectionRules(rec: any): ProtectionRules {
  const out: any = { ...PROTECTION_DEFAULTS };
  if (!rec) return out;
  for (const k of Object.keys(PROTECTION_DEFAULTS)) {
    const d = (PROTECTION_DEFAULTS as any)[k];
    const v = rec[k];
    if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
    else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const normName = (n: unknown) => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normWindow = (w: unknown) => String(w || '').toLowerCase().replace(/\s+/g, '').trim();
const normServices = (s: unknown) => (Array.isArray(s) ? s : []).map((x) => String(x || '').toLowerCase().trim()).filter(Boolean).sort().join(',');
const normAddress = (a: unknown) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Same date, window, services and address: an exact repeat of an earlier request. */
export function sameRequest(a: any, b: any): boolean {
  return !!a.requested_date && a.requested_date === b.requested_date
    && normWindow(a.availability_window) === normWindow(b.availability_window)
    && normServices(a.services) === normServices(b.services)
    && normAddress(a.address) === normAddress(b.address);
}

/** One-way fingerprint of the caller's network address. The address itself is never stored. */
export async function hashIp(req: Request): Promise<string | null> {
  const raw = (req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim();
  if (!raw) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cutdeluxe-ip|${raw}`));
  return Array.from(new Uint8Array(buf)).slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Request throttle for public endpoints that cost money per call (address search).
 * It extends this module rather than adding a second limiter: it keys on the same
 * one-way `hashIp` fingerprint, and the booking-protection limits above are untouched.
 *
 * Fixed windows, one counter row per caller per window. A refused request is never
 * counted, so it cannot burn the other window. Limits are per caller:
 *  - 30 a minute: a person typing an address with a debounce sends roughly 5 to 10
 *    searches per address, so this allows several addresses a minute.
 *  - 300 an hour: a long booking session, or a small office behind one connection.
 * A request with no readable address shares one bucket with 5 times the ceiling.
 */
export const PUBLIC_SEARCH_LIMITS = { perMinute: 30, perHour: 300 };
export interface RateLimitResult { allowed: boolean; retryAfterSeconds: number }

export function rateLimitBuckets(scope: string, ipHash: string | null, limits: { perMinute: number; perHour: number }, now: number) {
  const who = ipHash || 'no-ip';
  const scale = ipHash ? 1 : 5;
  const minute = Math.floor(now / 60_000);
  const hour = Math.floor(now / 3_600_000);
  return [
    { key: `${scope}|${who}|m|${minute}`, limit: limits.perMinute * scale, endsAt: (minute + 1) * 60_000 },
    { key: `${scope}|${who}|h|${hour}`, limit: limits.perHour * scale, endsAt: (hour + 1) * 3_600_000 },
  ];
}

/** Counts this request against the caller's windows, or refuses it when a ceiling is already reached. */
export async function takeRateLimitSlot(
  admin: any, scope: string, ipHash: string | null,
  limits: { perMinute: number; perHour: number } = PUBLIC_SEARCH_LIMITS, now: number = Date.now(),
): Promise<RateLimitResult> {
  const buckets = rateLimitBuckets(scope, ipHash, limits, now);
  const rows = await Promise.all(buckets.map(async (b) => asList(await admin.entities.RateLimitHit.filter({ bucket: b.key }, '-created_date', 1))[0] || null));
  for (let i = 0; i < buckets.length; i++) {
    if ((Number(rows[i]?.count) || 0) >= buckets[i].limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((buckets[i].endsAt - now) / 1000)) };
    }
  }
  await Promise.all(buckets.map((b, i) => rows[i]
    ? admin.entities.RateLimitHit.update(rows[i].id, { count: (Number(rows[i].count) || 0) + 1 })
    : admin.entities.RateLimitHit.create({ bucket: b.key, count: 1, expires_at: new Date(b.endsAt + 60_000).toISOString() })));
  // Housekeeping: now and then remove windows that have ended.
  if (Math.random() < 0.02) {
    try { await admin.entities.RateLimitHit.deleteMany({ expires_at: { $lt: new Date(now).toISOString() } }); } catch { /* next time */ }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Contact details that cannot belong to a real customer. Returns plain-language reasons. */
export function implausibleContact(c: { name?: unknown; phone?: unknown; email?: unknown }): string[] {
  const reasons: string[] = [];
  const phone = normaliseAuPhone(c.phone);
  if (!phone) reasons.push('The phone number is not a valid Australian number.');
  else {
    const tail = phone.slice(2);
    if (/^(\d)\1+$/.test(tail) || '0123456789012345'.includes(tail) || '9876543210987654'.includes(tail)) {
      reasons.push('The phone number looks made up (repeated or sequential digits).');
    }
  }
  const email = normaliseEmail(c.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) reasons.push('The email address is not valid.');
  const name = String(c.name || '').trim();
  // The surname TEST is the barber's explicit internal QA marker (shared/testData,
  // deliberately case-sensitive), so a test booking's name is never judged for
  // quality. Only the name is exempt: the phone, email, throttles and every
  // scheduling rule are still checked exactly as for any other booking.
  if (!isTestLastName(name)) {
    const letters = name.replace(/[^\p{L}]/gu, '');
    if (letters.length < 2) reasons.push('The name has no real letters in it.');
    else if (/^(.)\1+$/i.test(letters)) reasons.push('The name looks made up (one repeated letter).');
  }
  return reasons;
}

export interface Signals {
  phoneHour: number;
  emailHour: number;
  ipHour: number;
  activeUnconfirmed: number;
  distinctNamesDay: number;
  declinedRepeatHoursAgo: number | null;
}

/**
 * Reads how many earlier requests share this customer's phone, email and network
 * fingerprint. Counts exclude the booking being submitted. A read that fails
 * throws, and the caller turns that into a hold rather than letting it through.
 */
export async function gatherSignals(admin: any, p: {
  phoneKey: string | null; emailKey: string | null; ipHash: string | null;
  name: string; candidate: any; rules: ProtectionRules; now?: number;
}): Promise<Signals> {
  const now = p.now ?? Date.now();
  const hourAgo = new Date(now - 3600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const declinedSince = new Date(now - Math.max(p.rules.repeat_declined_hours, 1) * 3600_000).toISOString();
  const list = async (q: Record<string, any>) => asList(await admin.entities.BookingRequest.filter(q, '-created_date', 200));

  const [phoneDay, email, ip, pending, declined] = await Promise.all([
    p.phoneKey ? list({ phone_normalised: p.phoneKey, created_date: { $gte: dayAgo } }) : Promise.resolve([]),
    p.emailKey ? list({ email_normalised: p.emailKey, created_date: { $gte: hourAgo } }) : Promise.resolve([]),
    p.ipHash ? list({ submitter_ip_hash: p.ipHash, created_date: { $gte: hourAgo } }) : Promise.resolve([]),
    p.phoneKey ? list({ phone_normalised: p.phoneKey, status: 'pending' }) : Promise.resolve([]),
    p.phoneKey && p.rules.repeat_declined_hours > 0
      ? list({ phone_normalised: p.phoneKey, status: 'declined', declined_at: { $gte: declinedSince } })
      : Promise.resolve([]),
  ]);

  const names = new Set<string>(phoneDay.map((r: any) => normName(r.client_name)).filter(Boolean));
  names.add(normName(p.name));
  const repeat = declined.find((d: any) => sameRequest(d, p.candidate));

  return {
    phoneHour: phoneDay.filter((r: any) => String(r.created_date) >= hourAgo).length,
    emailHour: email.length,
    ipHour: ip.length,
    activeUnconfirmed: pending.filter((r: any) => r.protection_hold !== true).length,
    distinctNamesDay: names.size,
    declinedRepeatHoursAgo: repeat ? Math.max(0, Math.round((now - Date.parse(repeat.declined_at)) / 3600_000)) : null,
  };
}

export interface ProtectionResult { hold: boolean; reasons: string[]; codes: string[] }

/** Every reason that applies, each with its own code. A hold is never a rejection. */
export function evaluateProtection(input: {
  rules: ProtectionRules;
  signals: Signals;
  contact: { name?: unknown; phone?: unknown; email?: unknown };
  location: { tier?: string | null; distanceKm?: number | null };
}): ProtectionResult {
  const { rules, signals: s, contact, location } = input;
  const reasons: string[] = [];
  const codes: string[] = [];
  const add = (code: string, text: string) => { codes.push(code); reasons.push(text); };
  if (!rules.enabled) return { hold: false, reasons, codes };

  // +1 counts the booking being submitted.
  if (rules.max_per_phone_hour > 0 && s.phoneHour + 1 > rules.max_per_phone_hour) {
    add('rate_phone', `${s.phoneHour + 1} requests from this number in the last hour (limit ${rules.max_per_phone_hour}).`);
  }
  // No email, no email limit: an empty address is not "the same customer" as every other empty one.
  if (normaliseEmail(contact.email) && rules.max_per_email_hour > 0 && s.emailHour + 1 > rules.max_per_email_hour) {
    add('rate_email', `${s.emailHour + 1} requests from this email address in the last hour (limit ${rules.max_per_email_hour}).`);
  }
  if (rules.max_per_ip_hour > 0 && s.ipHour + 1 > rules.max_per_ip_hour) {
    add('rate_ip', `${s.ipHour + 1} requests from this network connection in the last hour (limit ${rules.max_per_ip_hour}).`);
  }
  if (rules.max_active_unconfirmed > 0 && s.activeUnconfirmed + 1 > rules.max_active_unconfirmed) {
    add('active_limit', `This customer would have ${s.activeUnconfirmed + 1} unconfirmed bookings open at once (limit ${rules.max_active_unconfirmed}).`);
  }
  if (rules.max_names_per_phone_day > 0 && s.distinctNamesDay > rules.max_names_per_phone_day) {
    add('many_names', `${s.distinctNamesDay} different names used with this phone number in 24 hours (limit ${rules.max_names_per_phone_day}).`);
  }
  if (rules.flag_outer_tier && location.tier === 'outer') {
    const km = typeof location.distanceKm === 'number' ? ` (${location.distanceKm.toFixed(1)} km from the nearest zone)` : '';
    add('far_address', `The address is in the outer service ring${km}, so a person should check it is reachable.`);
  }
  if (s.declinedRepeatHoursAgo !== null) {
    add('repeat_declined', `This is an exact repeat of a request from this number that was declined ${s.declinedRepeatHoursAgo} hour(s) ago.`);
  }
  for (const r of implausibleContact(contact)) add('bad_contact', r);

  return { hold: reasons.length > 0, reasons, codes };
}