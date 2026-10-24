/**
 * Provisional Placement — finds the best provisional slot for a new booking
 * request inside the customer's availability window.
 *
 * v1: deterministic gap-minimisation algorithm. No Mapbox calls during
 * booking submission — travel-time-aware optimisation is deferred to the
 * Auto Sort layer.
 *
 * Constraints (never violated):
 *  - Slot starts and ends inside the customer's availability window
 *  - Slot inside barber working hours
 *  - No overlap with existing appointments or blocks
 *
 * Scoring (lowest score wins):
 *  1. Proximity to nearest existing appointment (minimise gap → cluster)
 *  2. Earlier slot (tiebreaker)
 */

const SNAP_MIN = 5;
const SNAP_HRS = SNAP_MIN / 60;

export interface ExistingAppt {
  apptStart: number;
  apptEnd: number;
  isBlock?: boolean;
  status?: string;
}

export interface PlacementInput {
  windowStart: number;
  windowEnd: number;
  durationMins: number;
  existingAppts: ExistingAppt[];
  workStart: number;
  workEnd: number;
}

export interface PlacementResult {
  start: number | null; // decimal hour, or null if unscheduled
  status: 'provisional' | 'unscheduled';
}

function snapUp5(dec: number): number {
  return Math.ceil(dec / SNAP_HRS - 1e-9) * SNAP_HRS;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - 1e-9 && aEnd > bStart + 1e-9;
}

export function findProvisionalSlot(input: PlacementInput): PlacementResult {
  const { windowStart, windowEnd, durationMins, existingAppts, workStart, workEnd } = input;
  const dur = durationMins / 60;

  // Service must fit inside the availability window at all
  if (dur > windowEnd - windowStart + 1e-9) return { start: null, status: 'unscheduled' };

  // Effective bounds: intersection of availability window and barber working hours
  const effStart = Math.max(windowStart, workStart);
  const effEnd = Math.min(windowEnd, workEnd);
  if (effEnd - effStart < dur - 1e-9) return { start: null, status: 'unscheduled' };

  // Active existing appointments (exclude cancelled / no-show / completed)
  const active = existingAppts.filter(
    a => a.status !== 'cancelled' && a.status !== 'no_show' && a.status !== 'completed' && a.status !== 'declined'
  );

  // Generate all valid 5-min start times
  const candidates: number[] = [];
  let start = snapUp5(effStart);
  while (start + dur <= effEnd + 1e-9) {
    const end = start + dur;
    const clash = active.some(a => overlaps(start, end, a.apptStart, a.apptEnd));
    if (!clash) candidates.push(start);
    start += SNAP_HRS;
  }

  if (candidates.length === 0) return { start: null, status: 'unscheduled' };

  // Score: prefer slot with smallest gap to nearest existing appointment,
  // then earliest slot as tiebreaker. Clustering minimises both travel and
  // unnecessary idle gaps.
  let best = candidates[0];
  let bestScore = Infinity;

  for (const c of candidates) {
    const end = c + dur;
    let minGap = Infinity;
    for (const a of active) {
      if (a.apptStart >= end - 1e-9) minGap = Math.min(minGap, a.apptStart - end);
      if (a.apptEnd <= c + 1e-9) minGap = Math.min(minGap, c - a.apptEnd);
    }
    // Isolated slot (no neighbours) is deprioritised but not excluded
    const gapScore = minGap === Infinity ? 999 : minGap;
    const score = gapScore * 1000 + c;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return { start: best, status: 'provisional' };
}

/** Convert decimal hour → "2:30pm" label (mirrors frontend decimalToLabel) */
export function decimalToLabel(dec: number): string {
  if (dec == null || isNaN(dec)) return '';
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${h12}:00${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}

/** Parse "2:30pm" / "14:30" / "2pm" → decimal hour */
export function parseTimeStr(s: string): number {
  if (!s) return NaN;
  s = s.toLowerCase().replace(/\s/g, '');
  const isPm = s.endsWith('pm');
  const isAm = s.endsWith('am');
  s = s.replace('am', '').replace('pm', '');
  const [hStr, mStr] = s.includes(':') ? s.split(':') : [s, '0'];
  const h = Number(hStr);
  const m = Number(mStr) || 0;
  if (isNaN(h)) return NaN;
  let hh = h;
  if (isPm && hh !== 12) hh += 12;
  if (isAm && hh === 12) hh = 0;
  return hh + m / 60;
}

/**
 * Protection rule — determines if Route Flow automation is allowed to move
 * an appointment based on its schedule_status.
 *
 * provisional → automation_allowed = true  (Route Flow may move it)
 * locked      → automation_allowed = false (admin fixed the time)
 * confirmed   → automation_allowed = false (time committed to customer)
 *
 * This is the single source of truth for protection enforcement. Both the
 * UI and server-side functions must use this to decide what Route Flow can
 * touch. Route Flow must never automatically unlock, unconfirm, change a
 * locked/confirmed time, or create an availability override.
 */
export function isAutomationAllowed(scheduleStatus: string | null | undefined): boolean {
  return scheduleStatus === 'provisional';
}

/** How automatic optimisation must treat an appointment. */
export type AutomationClass = 'flexible' | 'manual' | 'communicated';

/**
 * The one rule that decides whether Route Flow may move an appointment.
 *
 *   flexible      nothing has been decided — nobody has been told a time.
 *   manual        the barber positioned it, but the client has not been told.
 *                 STILL eligible for optimisation: dragging a card is not a promise.
 *   communicated  the time has reached the customer (a confirmed time, an override
 *                 check that asked them to confirm, or a deliberate lock). Fixed
 *                 during automatic optimisation until the admin moves it themselves.
 *
 * The admin can always move any appointment; this only governs what automation
 * may do on its own.
 */
export function automationClass(booking: {
  schedule_status?: string | null;
  availability_override?: boolean | null;
  override_status?: string | null;
}): AutomationClass {
  const status = String(booking?.schedule_status || '');
  // A time confirmed with the client, or one the barber deliberately locked.
  if (status === 'confirmed' || status === 'locked') return 'communicated';
  // The customer was asked to confirm an out-of-availability time: the time has
  // been communicated even though it is not confirmed yet.
  if (booking?.availability_override === true && String(booking?.override_status || 'none') !== 'none') return 'communicated';
  if (status === 'provisional') return 'manual';
  return 'flexible';
}

/** True when automation may never move this appointment on its own. */
export function isFixedForAutomation(booking: {
  schedule_status?: string | null;
  availability_override?: boolean | null;
  override_status?: string | null;
}): boolean {
  return automationClass(booking) === 'communicated';
}

/** Parse availability window string "2pm-7pm" → { start, end } | null */
export function parseWindow(str: string): { start: number; end: number } | null {
  if (!str || str === 'Flexible') return null;
  const clean = str.replace(/\s/g, '').toLowerCase();
  const match = clean.match(/^(.+?)[–\-](.+)$/);
  if (!match) return null;
  const s = parseTimeStr(match[1]);
  const e = parseTimeStr(match[2]);
  if (isNaN(s) || isNaN(e)) return null;
  return { start: s, end: e };
}