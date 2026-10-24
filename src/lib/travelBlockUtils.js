/**
 * Travel block helpers — efficiency colour classification and rounding.
 * Green ≤ 15 min, Yellow ≤ 20 min, Red > 20 min.
 * Driving time is always rounded UP to the nearest 5 minutes for safety.
 */

export function roundTo5(mins) {
  return Math.ceil(mins / 5) * 5;
}

export function getEfficiency(mins) {
  if (mins <= 15) return 'green';
  if (mins <= 20) return 'yellow';
  return 'red';
}

// A drive block is its own calendar slot: a soft tinted fill, a solid
// route-accent border and a light shadow, so it reads as real scheduled time
// against the white grid. Text is the 700 weight of each hue so it stays
// legible on its own fill — the earlier 300-weight text was for a dark grid.
export const EFFICIENCY_STYLES = {
  green: {
    bg: 'linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%)',
    text: '#047857',
    border: 'rgba(16,185,129,0.45)',
    glow: '0 1px 2px rgba(16,24,40,0.06)',
  },
  yellow: {
    bg: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)',
    text: '#b45309',
    border: 'rgba(245,158,11,0.5)',
    glow: '0 1px 2px rgba(16,24,40,0.06)',
  },
  red: {
    bg: 'linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%)',
    text: '#b91c1c',
    border: 'rgba(239,68,68,0.45)',
    glow: '0 1px 2px rgba(16,24,40,0.06)',
  },
};