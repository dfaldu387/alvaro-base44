/**
 * Connected scheduling — how a flexible appointment is positioned on a day.
 *
 * A day is a chain, not a set of independent slots. The first fixed appointment
 * anchors the day; every flexible appointment after it starts as soon as the
 * previous appointment's occupancy ends, plus the road time between the two
 * customers. Nothing else is added: no slot-boundary rounding, no window-start
 * alignment, no second buffer.
 *
 *   Appointment 1  9:45am–10:20am   (anchor)
 *   drive          15 min
 *   Appointment 2  10:35am          ← chained, not 10:55am
 *
 * Rules (never violated):
 *  - A locked / confirmed / overridden appointment is an anchor and never moves.
 *  - Chaining starts at the day's first anchor. A flexible appointment that sits
 *    before it is left exactly where the barber put it.
 *  - An appointment is never chained outside its own availability window, outside
 *    working hours, or into the next anchor (the drive to that anchor is kept).
 *  - An appointment that cannot be chained cleanly is left untouched and reported
 *    as `unplaced` — never squeezed in and never dropped.
 *  - 5-minute scheduling increment, rounded UP: a 10:32 arrival is offered as 10:35.
 *
 * Pure: it reads a day description and returns the times it would use. Persisting
 * anything is the caller's job (routeFlowOptimiser / the Stage 0 validator).
 */

import { STEP_MINUTES } from './appointmentTiming.ts';

export interface ChainItem {
  id: string;
  /** Current start in decimal hours. null = not placed. */
  start: number | null;
  /** What the calendar holds: service + this booking's own configured buffer. */
  durationHours: number;
  /** Customer availability window; null on either side = flexible / working hours. */
  windowStart: number | null;
  windowEnd: number | null;
  /** Immovable: locked, confirmed, overridden, or blocked time. */
  anchor: boolean;
  block: boolean;
}

export interface ChainOptions {
  workStart: number;
  workEnd: number;
  /** Road minutes between two customers. null = not estimated. */
  driveFor: (fromId: string, toId: string) => number | null;
  /** Drive-matrix key for the barber's saved start location, when known. */
  startKey?: string | null;
  stepMinutes?: number;
  /**
   * Connect Appointments: the earliest appointment is the day's starting anchor
   * even when nothing has been communicated yet. The chain then follows the order
   * the barber arranged, instead of waiting for a locked or confirmed appointment
   * to anchor the day.
   */
  anchorFirst?: boolean;
}

export interface ChainResult {
  /** Chained start for every appointment that could be chained. */
  assigned: Map<string, number>;
  /** Flexible appointments that could not be chained — left untouched by the caller. */
  unplaced: string[];
  /** Flexible appointments whose chained time differs from where they sit now. */
  moved: string[];
  idleMinutes: number;
  driveMinutes: number;
}

/**
 * Round UP to the scheduling increment, in whole minutes so floating-point drift
 * cannot add an extra step (10:10 must never become 10:15).
 */
function snapUp(dec: number, stepHours: number): number {
  const stepMins = Math.round(stepHours * 60);
  return Math.round(Math.ceil(dec * 60 / stepMins - 1e-6) * stepMins) / 60;
}

/**
 * The occupancy end of an appointment placed at `start`: its own service plus its
 * own configured buffer, and nothing more.
 */
function occupancyEnd(item: ChainItem, start: number): number {
  return start + Math.max(0, item.durationHours || 0);
}

/** The latest this appointment may start and still finish inside its window and the day. */
function latestStart(item: ChainItem, workEnd: number): number {
  const windowEnd = item.windowEnd != null ? Math.min(item.windowEnd, workEnd) : workEnd;
  return windowEnd - Math.max(0, item.durationHours || 0);
}

/** The earliest this appointment may start at all. */
function earliestStart(item: ChainItem, workStart: number): number {
  const windowStart = item.windowStart != null ? Math.max(item.windowStart, workStart) : workStart;
  return windowStart;
}

/**
 * Chain the flexible appointments of one day forward from its anchors.
 *
 * The walk is chronological, so each appointment is positioned after the one
 * before it has already been placed — which is what makes a downstream
 * appointment recompute automatically when an earlier one moves.
 */
export function chainDay(items: ChainItem[], opts: ChainOptions): ChainResult {
  const workStart = Number(opts.workStart);
  const workEnd = Number(opts.workEnd);
  const stepHours = (opts.stepMinutes || STEP_MINUTES) / 60;
  const driveFor = opts.driveFor;
  const drive = (fromId: string, toId: string): number => {
    const raw = driveFor(fromId, toId);
    return raw == null ? 0 : Math.max(0, Number(raw) || 0);
  };

  const real = items.filter(i => !i.block);
  const blocks = items.filter(i => i.block && i.start != null)
    .map(b => ({ id: b.id, start: b.start as number, end: (b.start as number) + Math.max(0, b.durationHours || 0) }))
    .sort((a, b) => a.start - b.start);

  /**
   * Blocked time is occupied time, not a destination: the chain may never be
   * placed through it, so a chained start is pushed to the end of any block it
   * would land inside.
   */
  const avoidBlocks = (start: number, durationHours: number): number => {
    let s = start;
    for (let guard = 0; guard < blocks.length + 1; guard++) {
      const hit = blocks.find(b => s < b.end - 1e-9 && s + Math.max(0, durationHours) > b.start + 1e-9);
      if (!hit) return s;
      s = snapUp(hit.end, stepHours);
    }
    return s;
  };
  if (real.length === 0) return { assigned: new Map(), unplaced: [], moved: [], idleMinutes: 0, driveMinutes: 0 };

  // The day's own order. Anchors keep the times they hold; flexible appointments
  // are ordered by where they currently sit, so the chain follows the barber's plan.
  let anchors = real.filter(i => i.anchor && i.start != null).sort((a, b) => (a.start as number) - (b.start as number));
  if (opts.anchorFirst) {
    // The first appointment IS the day's starting anchor: connecting respects the
    // order the barber arranged, so the day always has somewhere to chain from.
    const first = real.filter(i => i.start != null).sort((a, b) => (a.start as number) - (b.start as number))[0];
    if (first && !anchors.some(a => a.id === first.id)) {
      anchors = [first, ...anchors].sort((a, b) => (a.start as number) - (b.start as number));
    }
  }
  // The anchor set is what the walk below follows, so a day whose first appointment
  // became the anchor behaves exactly like one anchored by a confirmed booking.
  const anchorIds = new Set(anchors.map(a => a.id));
  const movable = real.filter(i => !anchorIds.has(i.id)).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (anchors.length === 0) {
    // Nothing to anchor to: an unanchored day has no chain to build.
    return { assigned: new Map(), unplaced: movable.map(i => i.id), moved: [], idleMinutes: 0, driveMinutes: 0 };
  }

  const firstAnchorStart = anchors[0].start as number;
  const ordered = [...real].sort((a, b) => {
    const as = a.start ?? (a.anchor ? 0 : firstAnchorStart);
    const bs = b.start ?? (b.anchor ? 0 : firstAnchorStart);
    return as - bs;
  });

  const assigned = new Map<string, number>();
  const unplaced: string[] = [];
  const moved: string[] = [];

  // Where the day currently sits: the previous appointment and its occupancy end.
  let cursor: number | null = null;
  let previousId: string | null = null;
  // The next fixed appointment, so a chained time never eats the drive to it.
  const nextAnchorAfter = (fromStart: number): ChainItem | null => {
    const found = anchors.filter(a => (a.start as number) > fromStart + 1e-9).sort((a, b) => (a.start as number) - (b.start as number))[0];
    return found || null;
  };

  for (const item of ordered) {
    if (anchorIds.has(item.id)) {
      // A fixed appointment is never moved — chaining simply starts again after it.
      assigned.set(item.id, item.start as number);
      cursor = occupancyEnd(item, item.start as number);
      previousId = item.id;
      continue;
    }

    // Before the day's first anchor there is nothing to chain from: the barber's
    // own placement stands, and it stays the start of the day's chain.
    if ((item.start ?? Infinity) < firstAnchorStart - 1e-9) {
      if (item.start != null) {
        cursor = occupancyEnd(item, item.start);
        previousId = item.id;
      }
      continue;
    }

    if (cursor == null || previousId == null) {
      // No predecessor placed yet (first flexible appointment after an unplaced
      // anchor) — nothing to chain to.
      unplaced.push(item.id);
      continue;
    }

    const legMinutes = drive(previousId, item.id);
    const chained = cursor + legMinutes / 60;
    const earliest = Math.max(earliestStart(item, workStart), chained);
    const latest = latestStart(item, workEnd);
    // Rounding is the calendar's increment only — the drive time is never itself
    // rounded up, so 10:20 + 15 min is 10:35, not 10:55.
    let start = avoidBlocks(snapUp(earliest, stepHours), item.durationHours);

    // Never chain into the next fixed appointment: the drive to it has to fit.
    const next = nextAnchorAfter(start);
    if (next) {
      const toNext = drive(item.id, next.id);
      const latestBeforeNext = (next.start as number) - toNext / 60 - Math.max(0, item.durationHours || 0);
      if (start > latestBeforeNext + 1e-9) start = snapUp(Math.max(earliest, latest), stepHours);
      if (start > latestBeforeNext + 1e-9) {
        // It cannot be chained between the two fixed appointments without eating
        // the drive to the next one — leave it where it is and say so.
        if (item.start != null) {
          cursor = occupancyEnd(item, item.start);
          previousId = item.id;
        }
        unplaced.push(item.id);
        continue;
      }
    }

    if (start > latest + 1e-9) {
      if (item.start != null) {
        cursor = occupancyEnd(item, item.start);
        previousId = item.id;
      }
      unplaced.push(item.id);
      continue;
    }

    assigned.set(item.id, start);
    if (item.start == null || Math.abs(item.start - start) > 1e-9) moved.push(item.id);

    // The next appointment measures from THIS one's finish: downstream recomputes.
    cursor = occupancyEnd(item, start);
    previousId = item.id;
  }

  // What the resulting chain costs: driving between consecutive appointments and
  // the idle left over once that drive has happened. Protected breaks are time,
  // not a destination, so they are never a stop in the chain.
  const sequence = [...real]
    .map(i => ({ item: i, start: assigned.has(i.id) ? (assigned.get(i.id) as number) : i.start }))
    .filter(x => x.start != null)
    .sort((a, b) => (a.start as number) - (b.start as number));

  let driveMinutes = 0;
  let idleMinutes = 0;
  if (opts.startKey && sequence.length > 0) {
    const toFirst = driveFor(opts.startKey, sequence[0].item.id);
    if (toFirst != null) driveMinutes += Math.max(0, toFirst);
  }
  for (let i = 0; i < sequence.length - 1; i++) {
    const a = sequence[i];
    const b = sequence[i + 1];
    const aEnd = occupancyEnd(a.item, a.start as number);
    let gap = (b.start as number) - aEnd;
    for (const blk of blocks) {
      const covered = Math.min(b.start as number, (blk.start as number) + blk.durationHours) - Math.max(aEnd, blk.start as number);
      if (covered > 0) gap -= covered;
    }
    const d = drive(a.item.id, b.item.id);
    driveMinutes += d;
    const free = Math.max(0, gap * 60);
    if (free > d) idleMinutes += free - d;
  }

  return { assigned, unplaced, moved, idleMinutes: Math.round(idleMinutes), driveMinutes: Math.round(driveMinutes) };
}