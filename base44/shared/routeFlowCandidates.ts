/**
 * Route Flow (Stage 1) — candidate slot generation.
 *
 * Pure and deterministic: given a validation context, produce every start time
 * at which the whole appointment (service + buffer) still finishes inside the
 * customer's submitted availability AND inside normal working hours.
 *
 * Candidates are generated in 5-minute increments. A candidate is never
 * generated if the appointment cannot finish inside the window.
 *
 * This module only decides WHICH TIMES to test. Whether a candidate is allowed
 * is decided entirely by the Stage 0 validator (shared/schedulingValidator).
 */

import { snapUpToStep, SNAP_MINUTES } from './schedulingValidator.ts';

export interface CandidateSlot {
  start: number;
  end: number;
}

/** Safety cap — a 12-hour window in 5-minute steps is 144 slots. */
export const MAX_CANDIDATES = 600;

export function generateCandidateSlots(ctx: any): CandidateSlot[] {
  const durationHours = (Number(ctx?.calendar_minutes) || 0) / 60;
  if (!(durationHours > 0)) return [];
  if (ctx?.work?.status !== 'open' || !ctx?.work?.normal) return [];

  const work = ctx.work.normal;
  // Flexible availability means "no window constraint" — the working day bounds it.
  const windowStart = ctx.window ? ctx.window.start : work.start;
  const windowEnd = ctx.window ? ctx.window.end : work.end;

  const low = Math.max(windowStart, work.start);
  const high = Math.min(windowEnd, work.end);
  if (high - low < durationHours - 1e-9) return [];

  const slots: CandidateSlot[] = [];
  let start = snapUpToStep(low, SNAP_MINUTES);
  let guard = 0;
  while (start + durationHours <= high + 1e-9 && guard < MAX_CANDIDATES) {
    slots.push({ start, end: start + durationHours });
    start = snapUpToStep(start + SNAP_MINUTES / 60, SNAP_MINUTES);
    guard += 1;
  }
  return slots;
}

/**
 * A plain-language reason why nothing could be placed, chosen from the codes the
 * validator returned most often across every candidate. Deterministic: ties are
 * broken by a fixed priority so the same input always yields the same reason.
 *
 * Deliberately free of client names and contact details.
 */
const REASON_BY_CODE: Record<string, string> = {
  PROTECTED_APPOINTMENT: 'Existing appointments block all valid positions',
  APPOINTMENT_OVERLAP: 'Existing appointments block all valid positions',
  BREAK_CONFLICT: 'Existing appointments block all valid positions',
  INSUFFICIENT_TRAVEL: 'Travel could not fit',
  TRAVEL_UNVERIFIED: 'Travel could not be verified',
  OUTSIDE_WORKING_HOURS: 'No capacity during barber hours',
  INVALID_SERVICE_DURATION: 'The service duration is not usable',
  OUTSIDE_CUSTOMER_AVAILABILITY: 'No valid slot inside customer availability',
  COVERAGE_RESTRICTION: 'The service address is outside the service area',
  BOOKING_LEAD_TIME: 'Inside the booking notice period',
  BOOKING_TOO_SOON: 'Inside the booking notice period',
  BOOKING_TOO_FAR_AHEAD: 'Beyond the booking horizon',
  MISSING_REQUIRED_DATA: 'No valid slot inside customer availability',
};

const PRIORITY = [
  'PROTECTED_APPOINTMENT',
  'APPOINTMENT_OVERLAP',
  'BREAK_CONFLICT',
  'INSUFFICIENT_TRAVEL',
  'TRAVEL_UNVERIFIED',
  'OUTSIDE_WORKING_HOURS',
  'OUTSIDE_CUSTOMER_AVAILABILITY',
  'COVERAGE_RESTRICTION',
  'BOOKING_TOO_SOON',
  'BOOKING_TOO_FAR_AHEAD',
  'BOOKING_LEAD_TIME',
  'INVALID_SERVICE_DURATION',
  'MISSING_REQUIRED_DATA',
];

export function summariseNoSlotReason(results: any[], ctx: any): string {
  if (!results || results.length === 0) {
    if (ctx?.work?.status === 'closed') return 'No capacity during barber hours';
    return 'No valid slot inside customer availability';
  }

  const counts: Record<string, number> = {};
  for (const r of results) {
    for (const code of (r?.codes || [])) counts[code] = (counts[code] || 0) + 1;
  }

  let bestCode: string | null = null;
  let bestCount = -1;
  for (const code of PRIORITY) {
    const count = counts[code] || 0;
    if (count > bestCount) { bestCount = count; bestCode = count > 0 ? code : bestCode; }
  }

  if (!bestCode) return 'No valid slot inside customer availability';
  return REASON_BY_CODE[bestCode] || 'No valid slot inside customer availability';
}

/** Every blocking code seen, most frequent first — for the audit row. */
export function blockingCodes(results: any[], limit = 6): string[] {
  const counts: Record<string, number> = {};
  for (const r of results || []) {
    for (const code of (r?.codes || [])) counts[code] = (counts[code] || 0) + 1;
  }
  return Object.keys(counts)
    .sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b))
    .slice(0, limit);
}