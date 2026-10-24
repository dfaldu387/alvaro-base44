/**
 * Auto Sort Day — suggests an optimised appointment order for a single
 * barber's day using real Mapbox drive times, customer availability windows,
 * service durations, and barber working hours.
 *
 * Constraints (never violated):
 *  - Appointment stays inside the customer's availability window
 *  - Appointment stays inside barber working hours
 *  - No two appointments overlap
 *  - Locked / blocked appointments never move
 *  - Enough gap between consecutive appointments for the drive time
 *
 * Optimisation priority:
 *  1. Minimise total driving time
 *  2. Avoid long / red travel legs
 *  3. Reduce unnecessary idle gaps
 *
 * Returns a suggested schedule (preview) — nothing is persisted until Apply.
 */
import { snapTo5 } from '@/lib/timeUtils';
import { base44 } from '@/api/base44Client';
import { computeIdleMinutes, avoidableGaps } from '@/lib/idleGaps';

const MAX_PERMUTATIONS = 7; // N! search cap; greedy-only above this

// ── Coordinate → matrix index mapping ────────────────────────────────────
function buildCoordinateMap(appointments) {
  const coords = [];
  const indexByKey = {};
  const apptIndex = {};
  for (const a of appointments) {
    if (a.address_lat == null || a.address_lng == null) {
      apptIndex[a.id] = -1;
      continue;
    }
    const key = `${a.address_lat.toFixed(5)},${a.address_lng.toFixed(5)}`;
    if (!(key in indexByKey)) {
      indexByKey[key] = coords.length;
      coords.push([a.address_lat, a.address_lng]);
    }
    apptIndex[a.id] = indexByKey[key];
  }
  return { coords, apptIndex };
}

async function fetchDriveMatrix(coords) {
  if (coords.length < 2) return { durations: [[0]] };
  try {
    const res = await base44.functions.invoke('mapboxDriveMatrix', { coordinates: coords });
    const durations = res.data?.durations || [];
    if (!durations.length || !durations[0]?.length) return { durations: coords.map(() => coords.map(() => 0)) };
    return { durations };
  } catch {
    // Fallback: zero-cost matrix (degrades to greedy without travel data)
    return { durations: coords.map(() => coords.map(() => 0)) };
  }
}

function getDriveMins(fromId, toId, apptIndex, durations) {
  const i = apptIndex[fromId];
  const j = apptIndex[toId];
  if (i == null || j == null || i < 0 || j < 0) return null;
  if (!durations[i] || durations[i][j] == null) return null;
  return durations[i][j] / 60; // seconds → minutes
}

function computeTotalDrive(ordered, apptIndex, durations) {
  let total = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const drive = getDriveMins(ordered[i].id, ordered[i + 1].id, apptIndex, durations);
    if (drive != null) total += drive;
  }
  return Math.round(total);
}

// ── Permutation generator (small N only) ─────────────────────────────────
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) result.push([arr[i], ...perm]);
  }
  return result;
}

// ── Try one ordering of flexible appointments ─────────────────────────────
function tryAssign(flexOrder, fixed, workStart, workEnd, apptIndex, durations) {
  const placed = fixed.map(a => ({ ...a }));

  for (const flex of flexOrder) {
    const dur = flex.duration / 60;
    const winStart = flex.windowStart != null ? flex.windowStart : workStart;
    const winEnd = flex.windowEnd != null ? flex.windowEnd : workEnd;
    const earliest = Math.max(winStart, workStart);
    const latest = Math.min(winEnd, workEnd) - dur;
    if (earliest > latest) return { feasible: false };

    // Candidate start times: window start, and just after/before each placed appt ± drive
    const candidates = new Set();
    candidates.add(snapTo5(earliest));
    for (const p of placed) {
      const driveFromP = getDriveMins(p.id, flex.id, apptIndex, durations);
      candidates.add(snapTo5(driveFromP != null ? p.apptEnd + driveFromP / 60 : p.apptEnd));
      const driveToP = getDriveMins(flex.id, p.id, apptIndex, durations);
      candidates.add(snapTo5(driveToP != null ? p.apptStart - driveToP / 60 - dur : p.apptStart - dur));
    }
    const sortedCandidates = [...candidates].sort((a, b) => a - b);

    let placedAt = null;
    for (const start of sortedCandidates) {
      if (start < earliest - 0.001 || start > latest + 0.001) continue;
      const end = start + dur;

      // No overlap with any placed appointment
      let overlap = false;
      for (const p of placed) {
        if (start < p.apptEnd - 0.001 && end > p.apptStart + 0.001) { overlap = true; break; }
      }
      if (overlap) continue;

      // Travel feasibility: enough gap from previous and to next
      const prev = placed.filter(p => p.apptEnd <= start + 0.001).sort((a, b) => b.apptEnd - a.apptEnd)[0];
      const next = placed.filter(p => p.apptStart >= end - 0.001).sort((a, b) => a.apptStart - b.apptStart)[0];

      if (prev) {
        const drive = getDriveMins(prev.id, flex.id, apptIndex, durations);
        if (drive != null && start - prev.apptEnd < drive / 60 - 0.001) continue;
      }
      if (next) {
        const drive = getDriveMins(flex.id, next.id, apptIndex, durations);
        if (drive != null && next.apptStart - end < drive / 60 - 0.001) continue;
      }

      placedAt = start;
      break;
    }

    if (placedAt == null) return { feasible: false };
    placed.push({ ...flex, apptStart: placedAt, apptEnd: placedAt + dur });
  }

  placed.sort((a, b) => a.apptStart - b.apptStart);
  const totalDriveMins = computeTotalDrive(placed, apptIndex, durations);
  const idleMins = computeIdleMinutes(placed, (a, b) => getDriveMins(a.id, b.id, apptIndex, durations));
  return { feasible: true, schedule: placed, totalDriveMins, idleMins };
}

// ── Public entry point ────────────────────────────────────────────────────
export async function computeAutoSort(appointments, workStart, workEnd) {
  const sorted = [...appointments].sort((a, b) => a.apptStart - b.apptStart);
  // Overridden appointments (availability_override) are always treated as fixed —
  // Auto Sort must never move them or try to place them back inside availability.
  const isFixed = a => a.locked || a.schedule_status === 'locked' || a.schedule_status === 'confirmed' || a.isBlock || a.availability_override;
  const fixed = sorted.filter(isFixed);
  const flexible = sorted.filter(a => !isFixed(a));

  const { coords, apptIndex } = buildCoordinateMap(sorted);
  const { durations } = await fetchDriveMatrix(coords);

  const currentDriveMins = computeTotalDrive(sorted, apptIndex, durations);
  const driveFor = (a, b) => getDriveMins(a.id, b.id, apptIndex, durations);
  // Wasted time, not just driving: the empty minutes left over once the drive that
  // has to happen is accounted for. This is what the barber actually loses.
  const currentIdleMins = computeIdleMinutes(sorted, driveFor);
  const currentGaps = avoidableGaps(sorted, driveFor);

  if (flexible.length === 0) {
    return {
      feasible: true, suggestedSchedule: sorted, currentDriveMins, suggestedDriveMins: currentDriveMins,
      currentIdleMins, suggestedIdleMins: currentIdleMins, movedCount: 0, gaps: currentGaps,
    };
  }

  const perms = flexible.length <= MAX_PERMUTATIONS ? permutations(flexible) : [flexible];
  let best = null;
  for (const perm of perms) {
    const result = tryAssign(perm, fixed, workStart, workEnd, apptIndex, durations);
    if (!result.feasible) continue;
    // The cost of a day is everything the barber loses to it: driving plus the idle
    // time left over once the drive has happened. Lower is better; nothing else is weighted.
    const waste = result.totalDriveMins + result.idleMins;
    if (!best || waste < best.waste) best = { ...result, waste };
  }

  if (!best) {
    return {
      feasible: false, suggestedSchedule: sorted, currentDriveMins, suggestedDriveMins: currentDriveMins,
      currentIdleMins, suggestedIdleMins: currentIdleMins, movedCount: 0, gaps: currentGaps,
    };
  }

  const suggested = best.schedule;
  const movedCount = suggested.filter(a => {
    const before = sorted.find(s => s.id === a.id);
    return before && Math.abs(before.apptStart - a.apptStart) > 1e-6;
  }).length;

  return {
    feasible: true,
    suggestedSchedule: suggested,
    currentDriveMins,
    suggestedDriveMins: best.totalDriveMins,
    currentIdleMins,
    suggestedIdleMins: computeIdleMinutes(suggested, driveFor),
    movedCount,
    gaps: currentGaps,
  };
}