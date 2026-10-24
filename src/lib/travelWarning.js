import { decimalToLabel } from '@/lib/timeUtils';

/**
 * The facts behind a "travel time may not be achievable" decision.
 *
 * The backend decides whether travel is short (shared/schedulingValidator) and
 * reports each leg it checked: the drive from the previous appointment and the
 * drive to the next one, with the road time required and the time actually
 * available. This turns that result into the short, honest set of numbers the
 * barber needs before choosing to place the appointment anyway.
 *
 * `earliestStart` is only offered when the SHORTFALL IS BEFORE the appointment
 * (there was not enough room after the previous one), because that is the only
 * case where moving the appointment later fixes it. When the next appointment is
 * the one left without room, the appointment would have to start earlier, so no
 * single "earliest start" is claimed — the shortfall is simply reported.
 */
export function travelWarning(result, startDecimal) {
  const legs = [result?.travel?.previous, result?.travel?.next].filter(Boolean);
  const short = legs.filter(l => l.ok === false);

  const requiredMins = short.reduce(
    (max, l) => (typeof l.required_mins === 'number' ? Math.max(max, l.required_mins) : max), 0);
  const availableMins = short.reduce(
    (min, l) => (typeof l.available_mins === 'number' ? Math.min(min, l.available_mins) : min), Infinity);

  const beforeShort = short.find(l => l.to === 'PROPOSED' || /from the previous/i.test(l.label || ''));
  const start = Number.isFinite(startDecimal) ? startDecimal : null;
  const deficitMins = beforeShort
    && typeof beforeShort.required_mins === 'number'
    && typeof beforeShort.available_mins === 'number'
    ? beforeShort.required_mins - beforeShort.available_mins
    : null;
  const earliestStart = deficitMins != null && deficitMins > 0 && start != null
    ? Math.ceil((start + deficitMins / 60) * 12) / 12
    : null;

  return {
    requiredMins: short.some(l => typeof l.required_mins === 'number') ? requiredMins : null,
    availableMins: Number.isFinite(availableMins) ? availableMins : null,
    earliestStart,
    legs: short.map(l => ({
      label: l.label || 'drive',
      requiredMins: l.required_mins ?? null,
      availableMins: l.available_mins ?? null,
      from: l.from || null,
      to: l.to || null,
    })),
    lines: short.map(l => (typeof l.required_mins === 'number' && typeof l.available_mins === 'number'
      ? `The ${l.label} needs ${l.required_mins} minutes, but only ${Math.round(l.available_mins)} are available.`
      : `The ${l.label} could not be verified.`)),
    earliestLabel: earliestStart != null ? decimalToLabel(earliestStart) : null,
  };
}