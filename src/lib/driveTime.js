/**
 * Drive-time display rules — one place, so a travel time never disagrees
 * with itself between the calendar, the route and the summary.
 */

/**
 * Driving time, honest to the minute: a 12-minute drive reads 12, never 15.
 * Padding every leg to a 5-minute mark is what created gaps the barber could not
 * account for. The 5-minute increment belongs to the appointment start only.
 */
export function driveMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/**
 * The drive block's colour is its own duration rating:
 *   green  — 15 minutes or less
 *   yellow — 16 to 25 minutes
 *   red    — more than 25 minutes
 * Deliberately no legend: the block itself says how long the drive is.
 */
const TONES = {
  green: {
    pill: 'border-[#86efac] bg-[#dcfce7] text-[#166534]',
    icon: 'text-[#15803d]',
    bar: 'bg-[#4ade80]',
  },
  yellow: {
    pill: 'border-[#fde047] bg-[#fef9c3] text-[#854d0e]',
    icon: 'text-[#a16207]',
    bar: 'bg-[#facc15]',
  },
  red: {
    pill: 'border-[#fca5a5] bg-[#fee2e2] text-[#991b1b]',
    icon: 'text-[#b91c1c]',
    bar: 'bg-[#f87171]',
  },
};

export function driveTone(minutes) {
  const m = driveMinutes(minutes);
  if (m <= 15) return TONES.green;
  if (m <= 25) return TONES.yellow;
  return TONES.red;
}