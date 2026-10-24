import { decimalToLabel } from '@/lib/timeUtils';

/** Display helpers shared by the create-appointment form and its summary panel. */

/** 50 → "$50.00" */
export function money(value) {
  const n = Number(value);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** 45 → "45 min", 75 → "1 hr 15 min", 60 → "1 hr" */
export function serviceDuration(mins) {
  const n = Math.round(Number(mins) || 0);
  if (n <= 0) return '—';
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const rest = n % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

/** "5:00pm – 7:00pm" from two decimal hours. */
export function rangeLabel(startDecimal, endDecimal) {
  return `${decimalToLabel(startDecimal)} – ${decimalToLabel(endDecimal)}`;
}