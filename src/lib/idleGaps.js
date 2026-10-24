/**
 * Idle time in a day: the minutes an appointment sequence leaves empty that are not
 * needed for travel. Pure — no imports, no React — so the same rule is used by the
 * optimiser's preview and can be tested directly.
 *
 * A gap is only "wasted" to the extent it is longer than the drive that has to
 * happen in it. If travel is unknown for a pair, the drive counts as zero, which
 * overstates the waste rather than hiding it.
 */

/** Minutes of avoidable idle between consecutive appointments of an ordered list. */
export function computeIdleMinutes(ordered, driveFor) {
  let idle = 0;
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const from = ordered[i];
    const to = ordered[i + 1];
    const gap = (to.apptStart - from.apptEnd) * 60;
    if (!(gap > 0)) continue;
    const drive = driveFor(from, to);
    idle += Math.max(0, gap - (Number.isFinite(drive) ? drive : 0));
  }
  return Math.round(idle);
}

/** The individual gaps worth showing: idle longer than minMins. */
export function avoidableGaps(ordered, driveFor, minMins = 15) {
  const gaps = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const from = ordered[i];
    const to = ordered[i + 1];
    const gap = (to.apptStart - from.apptEnd) * 60;
    if (!(gap > 0)) continue;
    const drive = driveFor(from, to);
    const idle = gap - (Number.isFinite(drive) ? drive : 0);
    if (idle > minMins) {
      gaps.push({
        from_id: from.id,
        to_id: to.id,
        from_name: from.clientName || '',
        to_name: to.clientName || '',
        idle_mins: Math.round(idle),
      });
    }
  }
  return gaps;
}