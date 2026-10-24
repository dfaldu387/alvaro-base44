import { friendlyDate } from './bookingMessages.ts';

/**
 * Extra facts for the regular-client rebooking message: when the client last came, and how often they
 * usually do. Each key is present ONLY when it is genuinely known. A template that asks for one that is
 * missing is refused by the renderer (nothing is sent), so a gap can never reach a customer.
 *
 * "How often" is the measured gap when there is one, else a frequency a person chose. A bare system default
 * (cadence_source 'default', or an unconfirmed Monthly) is NOT a fact about the client and is left out.
 */
const weeks = (days: number) => Math.max(1, Math.round(days / 7));
const every = (w: number) => (w === 1 ? 'every week' : `every ${w} weeks`);

export function expectedFrequency(c: any): string | null {
  const interval = Number(c?.cadence_interval_days);
  if (c?.cadence_source === 'observed' && Number.isFinite(interval) && interval >= 1) return `about ${every(weeks(interval))}`;
  if (c?.cadence_source === 'default') return null;
  const label = String(c?.frequency || '');
  if (label === 'Monthly' && c?.cadence_source !== 'manual') return null;
  if (label === 'Weekly') return 'every week';
  if (label === 'Fortnightly') return 'every 2 weeks';
  if (label === 'Every 3 weeks') return 'every 3 weeks';
  if (label === 'Monthly') return 'about every month';
  if (label === 'Custom') { const d = Number(c?.custom_frequency_days); return Number.isFinite(d) && d >= 1 ? `about ${every(weeks(d))}` : null; }
  return null;
}

export function rebookingContext(c: any): Record<string, string> {
  const out: Record<string, string> = {};
  const last = String(c?.last_visit_date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(last)) out.last_visit = friendlyDate(last);
  const f = expectedFrequency(c);
  if (f) out.frequency = f;
  return out;
}