/**
 * Reshuffle Engine — Route Flow Step 4 (evaluate only).
 *
 * Answers one question: "could the Provisional appointments on this day be
 * arranged better?" It never persists anything — the caller decides what to do
 * with the result.
 *
 * Hard constraints (never violated):
 *  - Locked / Confirmed / overridden / blocked appointments are immovable anchors
 *  - Every proposed time stays completely inside the customer's availability window
 *  - Every proposed time stays inside the barber's NORMAL working hours
 *  - Service duration is preserved exactly
 *  - No overlapping appointments
 *  - No appointment is dropped to make room for another
 *  - 5-minute scheduling increment
 *
 * Optimisation priority (V1):
 *  1. Keep as many valid appointments scheduled as possible
 *  2. Minimise idle time (gaps beyond required travel)
 *  3. Minimise driving time
 *
 * Travel time is used internally for evaluation only — no permanent drive
 * blocks are created here.
 *
 * Metrics are the day's real cost:
 *  - driving = the leg from the barber's saved start location to the first
 *    appointment (never assumed to be zero — see `startKey`) plus every leg
 *    between consecutive appointments
 *  - idle    = unused time between consecutive appointments, once the required
 *    travel and any protected break / blocked time is accounted for. Service
 *    time and buffer time are never idle.
 *  - wasted  = driving + idle. Lower is better; nothing else is weighted.
 */
import { decimalToLabel } from './provisionalPlacement.ts';
import { chainDay } from './connectedSchedule.ts';

const SNAP_HRS = 5 / 60;
const MAX_SLOTS_PER_ITEM = 400;
const SEARCH_ROUNDS = 4;

// Meaningful-improvement thresholds (V1). Configurable internally — no UI yet.
const DRIVE_SAVED_MIN = 10; // minutes
const IDLE_SAVED_MIN = 15; // minutes

// An unplaced movable is never acceptable (no booking is ever dropped).
const UNPLACED_MOVABLE_PENALTY = 100000;
// Worth of scheduling one previously-unscheduled request, expressed in
// equivalent minutes of driving/idle. A candidate is only placed while it
// costs less than this — so "fit more bookings" can never produce a wildly
// worse route just to hit a headcount.
const EXTRA_BOOKING_BONUS = 30;

export interface EngineItem {
  id: string;
  clientName: string;
  /** Current decimal-hour start. null for unscheduled candidates. */
  start: number | null;
  durationHours: number;
  /** Customer availability window (decimal hours). null = flexible / use working hours. */
  windowStart: number | null;
  windowEnd: number | null;
  /** Immovable: locked, confirmed, overridden, manually placed or a block. */
  anchor: boolean;
  anchorReason: string | null;
  block: boolean;
  /** An existing unscheduled request Route Flow may offer a slot to. */
  candidate: boolean;
  lat: number | null;
  lng: number | null;
}

export interface MetricSet {
  totalDriveMinutes: number;
  totalIdleMinutes: number;
  scheduledCount: number;
}

export interface ScheduleChange {
  booking_request_id: string;
  client_name: string;
  from_label: string;
  to_label: string;
  moving: boolean;
  protected: boolean;
  anchor_reason: string | null;
  duration_mins: number;
  is_new: boolean;
}

export interface EvaluationResult {
  meaningful: boolean;
  reason?: string;
  current: MetricSet;
  proposed: MetricSet;
  improvement: {
    driveMinutesSaved: number;
    idleMinutesSaved: number;
    additionalBookingsFit: number;
  };
  changes: ScheduleChange[];
}

type DriveFn = (fromId: string, toId: string) => number | null;
type AssignFn = (id: string) => number | null;

interface Placed {
  id: string;
  start: number;
  end: number;
  block: boolean;
}

// ── Geometry helpers ───────────────────────────────────────────────────────
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - 1e-9 && aEnd > bStart + 1e-9;
}

function candidateSlots(item: EngineItem, workStart: number, workEnd: number): number[] {
  const base = item.windowStart != null ? item.windowStart : workStart;
  const lo = Math.max(workStart, base);
  const winEnd = item.windowEnd != null ? item.windowEnd : workEnd;
  const hi = Math.min(workEnd, winEnd) - item.durationHours;
  if (lo > hi + 1e-9) return [];
  const startIdx = Math.ceil(lo / SNAP_HRS - 1e-9);
  const endIdx = Math.floor(hi / SNAP_HRS + 1e-9);
  const out: number[] = [];
  for (let i = startIdx; i <= endIdx && out.length < MAX_SLOTS_PER_ITEM; i++) {
    out.push(i * SNAP_HRS);
  }
  return out;
}

// ── Metrics ────────────────────────────────────────────────────────────────
function orderMetrics(placed: Placed[], driveFn: DriveFn, startKey?: string | null) {
  const real = placed.filter(p => !p.block).sort((a, b) => a.start - b.start);
  const blocks = placed.filter(p => p.block);
  let drive = 0;
  let idle = 0;
  let shortfall = 0;

  // The day begins where the barber's own profile says it does: the leg from the
  // saved start location to the first appointment is real travel, never zero.
  // It carries no fixed time budget (the barber leaves when the day requires),
  // so it is measured but can never be a shortfall.
  if (startKey && real.length > 0) {
    const toFirst = driveFn(startKey, real[0].id);
    if (toFirst != null) drive += Math.max(0, toFirst);
  }

  for (let i = 0; i < real.length - 1; i++) {
    const a = real[i];
    const b = real[i + 1];
    // Gap and travel time must share a unit — both expressed in MINUTES here.
    let gap = (b.start - a.end) * 60;
    // Protected breaks sit between required activities: that time is committed,
    // not wasted, so it is never counted as idle.
    for (const blk of blocks) {
      const covered = Math.min(b.start, blk.end) - Math.max(a.end, blk.start);
      if (covered > 0) gap -= covered * 60;
    }
    gap = Math.max(0, gap);
    const raw = driveFn(a.id, b.id);
    const d = raw == null ? 0 : Math.max(0, raw);
    drive += d;
    if (gap > d) idle += gap - d;
    else shortfall += d - gap;
  }
  return { drive, idle, shortfall };
}

function buildPlaced(anchors: EngineItem[], pool: EngineItem[], assign: AssignFn): Placed[] {
  const out: Placed[] = [];
  for (const a of anchors) {
    if (a.start == null) continue;
    out.push({ id: a.id, start: a.start, end: a.start + a.durationHours, block: a.block });
  }
  for (const it of pool) {
    const s = assign(it.id);
    if (s == null) continue;
    out.push({ id: it.id, start: s, end: s + it.durationHours, block: false });
  }
  return out;
}

function canPlace(item: EngineItem, start: number, placed: Placed[], ignoreId: string, driveFn?: DriveFn): boolean {
  const end = start + item.durationHours;
  for (const p of placed) {
    if (p.id === ignoreId) continue;
    if (overlaps(start, end, p.start, p.end)) return false;
  }

  // A slot with no visual overlap can still be physically impossible: the day
  // has to contain the road time either side of it. Only appointments are
  // neighbours for travel — a protected break is time, not a destination — and
  // a leg that cannot be estimated is never treated as a block here (the Stage 0
  // validator is the authority on unverifiable travel).
  if (!driveFn) return true;
  const others = placed.filter(p => p.id !== ignoreId && !p.block);
  const previous = others
    .filter(p => p.end <= start + 1e-6)
    .sort((a, b) => b.end - a.end)[0];
  const next = others
    .filter(p => p.start >= end - 1e-6)
    .sort((a, b) => a.start - b.start)[0];

  if (previous) {
    const required = driveFn(previous.id, item.id);
    if (required != null && (start - previous.end) * 60 + 0.5 < required) return false;
  }
  if (next) {
    const required = driveFn(item.id, next.id);
    if (required != null && (next.start - end) * 60 + 0.5 < required) return false;
  }
  return true;
}

/**
 * 'improve' (default) — search for a lower-cost day, treating an unplaced movable
 * as unacceptable and preferring to fit unscheduled candidates.
 * 'fit'             — search for an arrangement that puts EVERY movable AND the
 * unscheduled candidate on the calendar, then take the lowest driving + idle
 * arrangement, with no other weighting. Used when a new request cannot be placed
 * on the day as it stands.
 */
export type Objective = 'improve' | 'fit';

/** Sorted start times of an arrangement — used only to break equal-score ties. */
function scheduleTimes(assign: Map<string, number | null>): number[] {
  const out: number[] = [];
  for (const s of assign.values()) if (s != null) out.push(s);
  return out.sort((a, b) => a - b);
}

/** True when arrangement `a` starts no later than `b` at the first difference. */
function earlierSchedule(a: Map<string, number | null>, b: Map<string, number | null>): boolean {
  const x = scheduleTimes(a);
  const y = scheduleTimes(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (Math.abs(x[i] - y[i]) > 1e-9) return x[i] < y[i];
  }
  return x.length < y.length;
}

interface Scored {
  score: number;
  drive: number;
  idle: number;
  shortfall: number;
  unplacedMovables: number;
  unplacedCandidates: number;
  placedCandidates: number;
  scheduledCount: number;
}

function scoreAssignment(
  anchors: EngineItem[],
  pool: EngineItem[],
  assign: AssignFn,
  driveFn: DriveFn,
  startKey?: string | null,
  objective: Objective = 'improve',
): Scored {
  const placed = buildPlaced(anchors, pool, assign);
  const { drive, idle, shortfall } = orderMetrics(placed, driveFn, startKey);

  let unplacedMovables = 0;
  let unplacedCandidates = 0;
  let placedCandidates = 0;
  let placedMovables = 0;
  for (const it of pool) {
    const s = assign(it.id);
    if (it.candidate) {
      if (s != null) placedCandidates++;
      else unplacedCandidates++;
    } else if (s == null) {
      unplacedMovables++;
    } else {
      placedMovables++;
    }
  }

  const anchorCount = anchors.filter(a => !a.block).length;
  // A shortfall means there is not enough gap for the required travel, so the
  // arrangement is not physically achievable — penalise it above mere idle.
  // Fitting the extra request is the whole point of the 'fit' objective, so an
  // unplaced candidate is priced exactly like an unplaced movable and nothing
  // else is weighted: the arrangement cost stays driving + idle.
  const shortfallCost = shortfall * 2;
  const score = objective === 'fit'
    ? drive + idle + shortfallCost + (unplacedMovables + unplacedCandidates) * UNPLACED_MOVABLE_PENALTY
    : drive + idle + shortfallCost + unplacedMovables * UNPLACED_MOVABLE_PENALTY - placedCandidates * EXTRA_BOOKING_BONUS;

  return {
    score,
    drive,
    idle,
    shortfall,
    unplacedMovables,
    unplacedCandidates,
    placedCandidates,
    scheduledCount: anchorCount + placedMovables + placedCandidates,
  };
}

// ── Seeding ────────────────────────────────────────────────────────────────
function windowEndOf(item: EngineItem): number {
  if (item.windowEnd != null) return item.windowEnd;
  if (item.windowStart != null) return item.windowStart;
  return 999;
}

function greedySeed(
  anchors: EngineItem[],
  pool: EngineItem[],
  slotsById: Record<string, number[]>,
  order: EngineItem[],
  driveFn: DriveFn,
): Map<string, number | null> {
  const seed = new Map<string, number | null>();
  for (const it of pool) seed.set(it.id, null);

  for (const it of order) {
    const placed = buildPlaced(anchors, pool, id => (seed.has(id) ? seed.get(id) ?? null : null));
    for (const s of slotsById[it.id] || []) {
      if (canPlace(it, s, placed, it.id, driveFn)) {
        seed.set(it.id, s);
        break;
      }
    }
  }
  return seed;
}

/**
 * The day as a chain: every flexible appointment starts as soon as the one before
 * it finishes, plus the road time between the two. This is the seed the search
 * starts from, so a flexible appointment is never parked at the start of the day,
 * away from the appointments it actually runs alongside.
 */
function connectedSeed(
  anchors: EngineItem[],
  pool: EngineItem[],
  driveFn: DriveFn,
  workStart: number,
  workEnd: number,
): Map<string, number | null> {
  const seed = new Map<string, number | null>();
  for (const it of pool) seed.set(it.id, null);
  const chain = chainDay(
    [...anchors, ...pool].map(it => ({
      id: it.id,
      start: it.start,
      durationHours: it.durationHours,
      windowStart: it.windowStart,
      windowEnd: it.windowEnd,
      anchor: it.anchor,
      block: it.block,
    })),
    { workStart, workEnd, driveFor: driveFn },
  );
  for (const it of pool) {
    const s = chain.assigned.get(it.id);
    if (s != null) seed.set(it.id, s);
  }
  return seed;
}

// ── Local search ───────────────────────────────────────────────────────────
function improve(
  anchors: EngineItem[],
  pool: EngineItem[],
  assign: Map<string, number | null>,
  slotsById: Record<string, number[]>,
  driveFn: DriveFn,
  startKey?: string | null,
  objective: Objective = 'improve',
): void {
  const read: AssignFn = id => (assign.has(id) ? assign.get(id) ?? null : null);

  for (let round = 0; round < SEARCH_ROUNDS; round++) {
    let improved = false;

    for (const it of pool) {
      const slots = slotsById[it.id] || [];
      if (slots.length === 0) continue;

      for (const s of slots) {
        // Always compare against the position the search currently holds, so an
        // improvement found earlier in the pass is never thrown away by a later,
        // worse slot being rejected.
        const current = read(it.id);
        if (current != null && Math.abs(s - current) < 1e-9) continue;
        const placed = buildPlaced(anchors, pool, read);
        if (!canPlace(it, s, placed, it.id, driveFn)) continue;

        const before = scoreAssignment(anchors, pool, read, driveFn, startKey, objective).score;
        assign.set(it.id, s);
        const after = scoreAssignment(anchors, pool, read, driveFn, startKey, objective).score;
        if (after < before - 1e-9) {
          improved = true;
        } else {
          assign.set(it.id, current);
        }
      }
    }

    if (!improved) break;
  }
}

// ── Change list ────────────────────────────────────────────────────────────
function buildChanges(items: EngineItem[], currentOf: AssignFn, proposedOf: AssignFn): ScheduleChange[] {
  const rows: Array<ScheduleChange & { sort: number }> = [];

  for (const it of items) {
    if (it.block) continue;

    if (it.anchor) {
      const label = it.start != null ? decimalToLabel(it.start) : '';
      rows.push({
        booking_request_id: it.id,
        client_name: it.clientName,
        from_label: label,
        to_label: label,
        moving: false,
        protected: true,
        anchor_reason: it.anchorReason || 'protected',
        duration_mins: Math.round(it.durationHours * 60),
        is_new: false,
        sort: it.start ?? 0,
      });
      continue;
    }

    const cur = currentOf(it.id);
    const prop = proposedOf(it.id);
    if (it.candidate && prop == null) continue;

    rows.push({
      booking_request_id: it.id,
      client_name: it.clientName,
      from_label: cur != null ? decimalToLabel(cur) : 'Unscheduled',
      to_label: prop != null ? decimalToLabel(prop) : cur != null ? decimalToLabel(cur) : '',
      moving: prop != null && (cur == null || Math.abs(prop - cur) > 1e-9),
      protected: false,
      anchor_reason: null,
      duration_mins: Math.round(it.durationHours * 60),
      is_new: it.candidate,
      sort: prop != null ? prop : cur ?? 0,
    });
  }

  rows.sort((a, b) => a.sort - b.sort);
  return rows.map(({ sort, ...rest }) => rest);
}

// ── Public entry point ─────────────────────────────────────────────────────
/**
 * Evaluate whether the provisional appointments in `items` can be arranged
 * better. Pure and side-effect free — nothing is persisted.
 */
export interface ScheduleOptions {
  /**
   * Drive-matrix key for the barber's saved start location. When supplied, the
   * leg from that origin to the day's first appointment is counted as real
   * driving time instead of being treated as free. Omitted = the first leg
   * cannot be measured, so it contributes nothing.
   */
  startKey?: string | null;
  /** Default 'improve' — see Objective. */
  objective?: Objective;
}

export function evaluateSchedule(
  items: EngineItem[],
  workStart: number,
  workEnd: number,
  driveFn: DriveFn,
  options: ScheduleOptions = {},
): EvaluationResult {
  const startKey = options?.startKey || null;
  const objective: Objective = options?.objective === 'fit' ? 'fit' : 'improve';
  const anchors = items.filter(i => i.anchor);
  const pool = items.filter(i => !i.anchor);
  const movables = pool.filter(i => !i.candidate);

  // The connected seed is built first: its chained times join each appointment's
  // own slot list, so the search can always reach the exactly-connected start
  // (10:20 finish + 15 min drive = 10:35) instead of only the window's own grid.
  const connected = connectedSeed(anchors, pool, driveFn, workStart, workEnd);
  const slotsById: Record<string, number[]> = {};
  for (const it of pool) {
    const slots = candidateSlots(it, workStart, workEnd);
    const chained = connected.get(it.id);
    if (chained != null && !slots.some(s => Math.abs(s - chained) < 1e-9)) {
      slots.push(chained);
      slots.sort((a, b) => a - b);
    }
    slotsById[it.id] = slots;
  }

  const currentAssign = new Map<string, number | null>();
  for (const it of pool) currentAssign.set(it.id, it.candidate ? null : it.start);
  const currentOf: AssignFn = id => (currentAssign.has(id) ? currentAssign.get(id) ?? null : null);

  const currentRes = scoreAssignment(anchors, pool, currentOf, driveFn, startKey, objective);
  const current: MetricSet = {
    totalDriveMinutes: Math.round(currentRes.drive),
    totalIdleMinutes: Math.round(currentRes.idle),
    scheduledCount: currentRes.scheduledCount,
  };

  const emptyResult = (reason: string): EvaluationResult => ({
    meaningful: false,
    reason,
    current,
    proposed: { ...current },
    improvement: { driveMinutesSaved: 0, idleMinutesSaved: 0, additionalBookingsFit: 0 },
    changes: [],
  });

  if (movables.length === 0 && pool.length === 0) return emptyResult('nothing_to_optimise');

  const seeds: Array<Map<string, number | null>> = [
    new Map(currentAssign),
    // The chain comes before the greedy seeds: a day that can be connected beats one
    // that is merely re-ordered, and 'improve' is first-seed-wins on ties.
    connected,
    greedySeed(anchors, pool, slotsById, [...pool].sort((a, b) => windowEndOf(a) - windowEndOf(b) || b.durationHours - a.durationHours), driveFn),
    greedySeed(anchors, pool, slotsById, [...pool].sort((a, b) => (a.windowStart ?? workStart) - (b.windowStart ?? workStart) || b.durationHours - a.durationHours), driveFn),
    greedySeed(anchors, pool, slotsById, [...pool].sort((a, b) => b.durationHours - a.durationHours), driveFn),
  ];

  let best: { assign: Map<string, number | null>; res: Scored } | null = null;
  for (const seed of seeds) {
    const assign = new Map(seed);
    improve(anchors, pool, assign, slotsById, driveFn, startKey, objective);
    const res = scoreAssignment(anchors, pool, id => (assign.has(id) ? assign.get(id) ?? null : null), driveFn, startKey, objective);
    // A tie between complete arrangements is broken deterministically in favour
    // of the earlier schedule. 'improve' keeps its original first-seed-wins order.
    const tie = objective === 'fit' && !!best && Math.abs(res.score - best.res.score) <= 1e-9
      && earlierSchedule(assign, best.assign);
    if (!best || res.score < best.res.score - 1e-9 || tie) best = { assign, res };
  }

  if (!best) return emptyResult('no_arrangement_found');
  // No booking is ever dropped: every scheduled appointment stays on the calendar.
  if (best.res.unplacedMovables > 0) return emptyResult('no_feasible_arrangement');
  if (objective === 'fit') {
    // The whole point of this search is that the unresolved request is on the
    // calendar at the end of it.
    if (best.res.unplacedCandidates > 0) return emptyResult('no_feasible_arrangement');
    // A shortfall means a gap is smaller than the road time that leg actually
    // needs, so the day cannot physically contain the arrangement.
    if (best.res.shortfall > 0.5) return emptyResult('travel_infeasible');
  }

  const proposedOf: AssignFn = id => (best!.assign.has(id) ? best!.assign.get(id) ?? null : null);
  const proposed: MetricSet = {
    totalDriveMinutes: Math.round(best.res.drive),
    totalIdleMinutes: Math.round(best.res.idle),
    scheduledCount: best.res.scheduledCount,
  };

  const driveMinutesSaved = current.totalDriveMinutes - proposed.totalDriveMinutes;
  const idleMinutesSaved = current.totalIdleMinutes - proposed.totalIdleMinutes;
  const additionalBookingsFit = proposed.scheduledCount - current.scheduledCount;

  const changes = buildChanges(items, currentOf, proposedOf);
  const anyChange = changes.some(c => c.moving || c.is_new);

  // Adding a valid extra booking is itself a meaningful improvement: when a
  // request cannot be placed on the day as it stands, fitting it — without
  // dropping any existing booking — decides the outcome, even when the
  // rearranged day is no cheaper to run.
  const meaningful = objective === 'fit'
    ? (anyChange && best.res.placedCandidates > 0 && additionalBookingsFit >= 1)
    : (anyChange &&
      (driveMinutesSaved >= DRIVE_SAVED_MIN ||
        idleMinutesSaved >= IDLE_SAVED_MIN ||
        additionalBookingsFit >= 1));

  return {
    meaningful,
    reason: meaningful ? undefined : 'not_meaningfully_better',
    current,
    proposed,
    improvement: { driveMinutesSaved, idleMinutesSaved, additionalBookingsFit },
    changes,
  };
}