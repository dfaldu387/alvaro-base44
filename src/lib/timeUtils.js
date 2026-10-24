/**
 * Shared time utilities — no decimal times exposed to the user.
 */

/** Convert decimal hour (e.g. 14.5) → "2:30pm" */
export function decimalToLabel(dec) {
  if (dec == null || isNaN(dec)) return '';
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${h12}:00${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}

/** Convert "2:30pm" / "14:30" / "2pm" → decimal hour */
export function parseTimeStr(s) {
  if (!s) return NaN;
  s = s.toLowerCase().replace(/\s/g, '');
  const isPm = s.endsWith('pm');
  const isAm = s.endsWith('am');
  s = s.replace('am', '').replace('pm', '');
  let [h, m] = s.includes(':') ? s.split(':').map(Number) : [Number(s), 0];
  if (isNaN(h)) return NaN;
  if (isPm && h !== 12) h += 12;
  if (isAm && h === 12) h = 0;
  return h + (m || 0) / 60;
}

/** Build a list of time options from startHour to endHour in 15-min steps */
export function buildTimeOptions(startHour = 6, endHour = 22) {
  const opts = [];
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === endHour && m > 0) break;
      const dec = h + m / 60;
      opts.push({ label: decimalToLabel(dec), value: dec });
    }
  }
  return opts;
}

/** Snap decimal to nearest 15-min interval */
export function snapDecimal(dec) {
  const snap = 15 / 60;
  return Math.round(dec / snap) * snap;
}

/** Snap decimal to nearest 30-min interval (authoritative scheduling increment) */
export function snapTo30(dec) {
  const snap = 30 / 60;
  return Math.round(dec / snap) * snap;
}

/** Snap decimal to nearest 5-min interval (fine-grained drag-to-move increment) */
export function snapTo5(dec) {
  const snap = 5 / 60;
  return Math.round(dec / snap) * snap;
}