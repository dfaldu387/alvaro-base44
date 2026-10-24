import { decimalToLabel } from '@/lib/timeUtils';

/**
 * Two appointments on the same day, for the same barber, whose SERVICE time overlaps.
 * A double booking is impossible to serve, so it is reported here and blocked before a
 * day is confirmed. Occupancy buffers are deliberately not used: a buffer may legally
 * overlap the next client's start (that is what travel and pack-down are for), a
 * haircut may not.
 *
 * The server applies the same rule (base44/shared/scheduleOverlap.ts) when a single
 * confirmation is saved, so the Calendar, the Route tab and the backend agree.
 */
const NOT_OCCUPYING = new Set(['cancelled', 'no_show', 'declined']);

const sameBarber = (a, b) => (a.teamMemberId || 'unassigned') === (b.teamMemberId || 'unassigned');

export function findDayConflicts(appointments = []) {
  const list = appointments.filter((a) => a
    && a.date
    && a.requestId
    && !a.isBlock
    && a.apptStart != null
    && a.apptEnd != null
    && !NOT_OCCUPYING.has(a.status));

  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.date !== b.date || !sameBarber(a, b)) continue;
      if (a.apptStart < b.apptEnd && a.apptEnd > b.apptStart) {
        out.push({
          date: a.date,
          overlapMinutes: Math.round((Math.min(a.apptEnd, b.apptEnd) - Math.max(a.apptStart, b.apptStart)) * 60),
          a: { id: a.id, requestId: a.requestId, clientName: a.clientName, time: decimalToLabel(a.apptStart) },
          b: { id: b.id, requestId: b.requestId, clientName: b.clientName, time: decimalToLabel(b.apptStart) },
        });
      }
    }
  }
  return out.sort((x, y) => x.overlapMinutes - y.overlapMinutes).reverse();
}

/** "Tara at 11:25am and moey at 12:25pm overlap by 20 min" */
export function conflictSummary(conflict) {
  if (!conflict) return '';
  return `${conflict.a.clientName} at ${conflict.a.time} and ${conflict.b.clientName} at ${conflict.b.time} overlap by ${conflict.overlapMinutes} min`;
}