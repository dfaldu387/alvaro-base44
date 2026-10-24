/**
 * Reminder cadence measured from a client's own completed visits.
 * Pure functions: no database, no messages. Dependency-free so the admin screens can use it too.
 *
 * Choices (change them here and nowhere else):
 *   RECENT_VISITS   6   the last six distinct visit days are used, so a changed rhythm is followed.
 *   MIN_VISITS      4   fewer than four completed visits is never trusted as a pattern.
 *   MIN_USABLE_GAPS 3   at least three usable gaps must remain after dropping absurd ones.
 *   MAX_GAP_DAYS    120 a gap longer than this is left out entirely (never clamped).
 * The measured cadence is the MEDIAN of the usable gaps, so one holiday does not move it.
 */
export const RECENT_VISITS = 6;
export const MIN_VISITS = 4;
export const MIN_USABLE_GAPS = 3;
export const MAX_GAP_DAYS = 120;

export const FREQUENCY_DAYS: Record<string, number> = { Weekly: 7, Fortnightly: 14, 'Every 3 weeks': 21, Monthly: 30 };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const addDaysYmd = (ymd: string, n: number) => new Date((dayNum(ymd) + n) * 86400000).toISOString().slice(0, 10);

export interface Measurement {
  days: number | null;     // the measured cadence, or null when it cannot be trusted
  visits: number;          // distinct completed visit days used (at most RECENT_VISITS)
  usableGaps: number;
  excludedGaps: number;    // gaps above the ceiling, left out
  reason: 'ok' | 'not_enough_visits' | 'not_enough_usable_gaps';
}

/** Completed, real visits only: no-shows, cancellations, declined, pending and test data are not visits. */
export function visitDates(bookings: any[]): string[] {
  const set = new Set<string>();
  for (const b of bookings || []) {
    if (b?.status !== 'completed' || b?.is_test === true) continue;
    const d = String(b.requested_date || '');
    if (YMD.test(d)) set.add(d);
  }
  return [...set].sort().slice(-RECENT_VISITS);
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function measureCadence(bookings: any[]): Measurement {
  const dates = visitDates(bookings);
  const none = (reason: Measurement['reason'], usable = 0, excluded = 0): Measurement => ({ days: null, visits: dates.length, usableGaps: usable, excludedGaps: excluded, reason });
  if (dates.length < MIN_VISITS) return none('not_enough_visits');
  const gaps = dates.slice(1).map((d, i) => dayNum(d) - dayNum(dates[i]));
  const usable = gaps.filter(g => g >= 1 && g <= MAX_GAP_DAYS);
  const excluded = gaps.length - usable.length;
  if (usable.length < MIN_USABLE_GAPS) return none('not_enough_usable_gaps', usable.length, excluded);
  return { days: Math.max(1, Math.round(median(usable))), visits: dates.length, usableGaps: usable.length, excludedGaps: excluded, reason: 'ok' };
}

export type StoredSource = 'manual' | 'observed' | 'default' | 'unknown';

/**
 * Where the cadence in use came from. A stored cadence_source is believed. Records from before this field
 * existed have none: a label other than "Monthly" can only have been chosen by a person (the website and
 * calendar defaults only ever write Monthly), so it counts as manual. A bare "Monthly" cannot be told from a
 * default, so it is "unknown": the label is used, a measurement is never allowed to replace it by guesswork.
 */
export function storedSource(client: any, opts: { monthlyIsDefault?: boolean } = {}): StoredSource {
  const s = client?.cadence_source;
  if (s === 'manual' || s === 'observed' || s === 'default') return s;
  if (client?.frequency && client.frequency !== 'Monthly') return 'manual';
  return opts.monthlyIsDefault ? 'default' : 'unknown';
}

export function labelDays(client: any): number {
  return client?.frequency === 'Custom' ? Number(client.custom_frequency_days) || 0 : FREQUENCY_DAYS[client?.frequency] || 0;
}
export function labelText(client: any): string {
  return client?.frequency === 'Custom' ? `every ${Number(client.custom_frequency_days) || '?'} days` : String(client?.frequency || 'no frequency');
}

export interface Resolved { source: StoredSource; days: number; labelDays: number; measuredDays: number | null; visits: number }

/** The cadence that wins: a person's choice always; otherwise a trusted measurement; otherwise the label. */
export function resolveCadence(client: any): Resolved {
  const src = storedSource(client);
  const m = Number(client?.cadence_interval_days);
  const visits = Number(client?.cadence_visit_count) || 0;
  const measured = m > 0 && visits >= MIN_VISITS ? m : null;
  const ld = labelDays(client);
  if ((src === 'observed' || src === 'default') && measured) return { source: 'observed', days: measured, labelDays: ld, measuredDays: measured, visits };
  return { source: src === 'observed' ? 'default' : src, days: ld, labelDays: ld, measuredDays: measured, visits };
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * The stored-field changes a fresh measurement implies. Only fields that actually change are returned, and
 * cadence_computed_at is only touched when something did, so running it again changes nothing.
 * A manual source is never altered. Test clients are never measured.
 */
export function cadencePatch(client: any, bookings: any[], nowIso: string, opts: { monthlyIsDefault?: boolean } = {}) {
  if (client?.is_test === true) return { patch: {} as Record<string, any>, measurement: null as Measurement | null };
  const m = measureCadence(bookings);
  const cur = storedSource(client, opts);
  const next: StoredSource = cur === 'observed' || cur === 'default' ? (m.days ? 'observed' : 'default') : cur;
  const want: Record<string, any> = { cadence_interval_days: m.days, cadence_visit_count: m.visits };
  if (next !== 'unknown') want.cadence_source = next;
  const changed = Object.keys(want).filter(k => !same(client?.[k], want[k]));
  const patch: Record<string, any> = {};
  if (changed.length) { for (const k of Object.keys(want)) patch[k] = want[k]; patch.cadence_computed_at = nowIso; }
  return { patch, measurement: m };
}

/** Plain words for the client record and the campaign board. */
export function explainCadence(client: any) {
  const r = resolveCadence(client);
  const label = labelText(client);
  const m = r.measuredDays;
  const measuredText = m ? `about every ${m} days, from ${r.visits} visits` : '';
  const differs = !!m && m !== r.labelDays;
  let text: string;
  if (r.source === 'observed') text = `Comes in ${measuredText}.${r.labelDays ? ` (Label says ${label}.)` : ''}`;
  else if (r.source === 'manual') text = m && differs ? `Set to ${label} by you. Visits suggest ${measuredText}.` : `Set to ${label} by you.`;
  else if (r.source === 'unknown') text = m ? `Using ${label}, which is not confirmed as your choice. Visits suggest ${measuredText}.` : `Not enough history, using ${label}.`;
  else text = `Not enough history, using ${label}.`;
  return { text, source: r.source, measured_days: m, visits: r.visits, label, label_days: r.labelDays, differs, can_accept: !!m && (r.source !== 'manual' || differs) };
}