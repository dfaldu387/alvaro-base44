/**
 * Route Flow (Stage 1) — candidate scoring and ranking.
 *
 * V1 cost model, deliberately simple:
 *
 *   driving_minutes = road time from the previous appointment + road time to the
 *                     next appointment (Mapbox estimates, already resolved by the
 *                     Stage 0 validator's travel index). The FIRST appointment of
 *                     a barber's day has no previous appointment, so that leg runs
 *                     from the barber's saved start location and is scored as real
 *                     road travel — never as zero.
 *   idle_minutes    = unused calendar time left on each side of the placement,
 *                     measured to the neighbouring commitment and REDUCED by the
 *                     travel that side actually needs
 *   wasted_minutes  = driving_minutes + idle_minutes
 *
 *   Lowest wasted_minutes wins. Equal scores → the earlier start time wins.
 *
 * Idle deliberately excludes service time, buffer time and required travel, and
 * it is only counted where there is a neighbouring commitment to be tight
 * against — an empty day has nothing to cluster around, so every slot ties and
 * the earliest valid slot is chosen.
 *
 * No commercial weighting, no favourite weighting, no group priority, no revenue
 * scoring in Stage 1.
 */

export interface CandidateScore {
  start: number;
  label: string;
  valid: boolean;
  codes: string[];
  drive_previous_mins: number;
  drive_next_mins: number;
  driving_minutes: number;
  idle_previous_mins: number;
  idle_next_mins: number;
  idle_minutes: number;
  wasted_minutes: number;
  previous_label: string | null;
  next_label: string | null;
  /** True when the first leg of the day runs from the barber's start location. */
  previous_from_start: boolean;
  /** The start location the first leg runs from, when applicable. */
  origin_label: string | null;
  result: any;
}

export function scoreCandidate(ctx: any, result: any): CandidateScore {
  const start = result.proposed_start_decimal;
  const blockEnd = start + (Number(ctx.calendar_minutes) || 0) / 60;

  // Road time either side of the proposed appointment (0 when there is no
  // neighbour on that side; a leg that could not be verified makes the candidate
  // invalid, so it is never scored as if it were free).
  const drivePrevious = num(result?.travel?.previous?.required_mins);
  const driveNext = num(result?.travel?.next?.required_mins);

  // First appointment of the day: the leg runs from the barber's saved start
  // location, so its road time is real travel rather than an assumed zero.
  const previousFromStart = result?.travel?.previous?.from_start === true;
  const originLabel = previousFromStart ? (result?.travel?.previous?.from || null) : null;

  // Neighbouring commitments on the same barber's day — appointments AND blocks,
  // because blocked time is protected and is never counted as idle.
  const others = (ctx.occupied || []).filter((o: any) => o.id !== ctx.booking?.id);
  const previous = others
    .filter((o: any) => o.occupied_end <= start + 1e-6)
    .sort((a: any, b: any) => b.occupied_end - a.occupied_end)[0] || null;
  const next = others
    .filter((o: any) => o.start >= blockEnd - 1e-6)
    .sort((a: any, b: any) => a.start - b.start)[0] || null;

  const idlePrevious = previous
    ? Math.max(0, Math.round((start - previous.occupied_end) * 60) - drivePrevious)
    : 0;
  const idleNext = next
    ? Math.max(0, Math.round((next.start - blockEnd) * 60) - driveNext)
    : 0;

  const driving = drivePrevious + driveNext;
  const idle = idlePrevious + idleNext;

  return {
    start,
    label: result.proposed_start,
    valid: result.valid === true,
    codes: result.codes || [],
    drive_previous_mins: drivePrevious,
    drive_next_mins: driveNext,
    driving_minutes: driving,
    idle_previous_mins: idlePrevious,
    idle_next_mins: idleNext,
    idle_minutes: idle,
    wasted_minutes: driving + idle,
    previous_label: previous ? previous.label : null,
    next_label: next ? next.label : null,
    previous_from_start: previousFromStart,
    origin_label: originLabel,
    result,
  };
}

/** Lowest wasted time first; equal cost → earlier start time. Deterministic. */
export function rankCandidates(scores: CandidateScore[]): CandidateScore[] {
  return [...scores].sort((a, b) => (a.wasted_minutes - b.wasted_minutes) || (a.start - b.start));
}

/** Compact, name-free explanation written to the audit trail. */
export function explainPlacement(
  score: CandidateScore,
  validCount: number,
  candidateCount: number,
  retries = 0,
): string {
  const legs: string[] = [];
  if (score.previous_from_start) legs.push(`${score.drive_previous_mins} min from start location`);
  else if (score.previous_label) legs.push(`${score.drive_previous_mins} min from previous`);
  if (score.next_label) legs.push(`${score.drive_next_mins} min to next`);

  return [
    `Auto-placed ${score.label}`,
    legs.length ? `drive ${score.driving_minutes} min (${legs.join(', ')})` : 'no adjacent appointments',
    `idle ${score.idle_minutes} min`,
    `waste ${score.wasted_minutes} min`,
    `${validCount} valid of ${candidateCount} candidates`,
    retries ? `retried ${retries}x` : '',
  ].filter(Boolean).join(' · ').slice(0, 400);
}

function num(value: any): number {
  const n = Number(value);
  return isFinite(n) && n > 0 ? Math.round(n) : 0;
}