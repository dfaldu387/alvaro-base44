import { parseTimeStr } from '@/lib/timeUtils';

/**
 * The availability window a customer chose, as the calendar needs to draw it.
 *
 * "12:00pm–3:00pm" → { start: 12, end: 15 }. A flexible or unusable window is null
 * (no range to shade, and nothing to override). The stored text is never changed:
 * an override records itself beside the customer's original window.
 */
export function parseAvailabilityWindow(raw) {
  const text = String(raw || '').trim();
  if (!text || /flexible/i.test(text)) return null;
  const match = text.replace(/\s/g, '').toLowerCase().match(/^(.+?)[–—\-](.+)$/);
  if (!match) return null;
  const start = parseTimeStr(match[1]);
  const end = parseTimeStr(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/**
 * The latest start that still leaves room for the whole service inside the window.
 * A window ending at 3:00pm with a 35-minute cut means 2:25pm, not 3:00pm.
 */
export function latestValidStart(win, durationMins) {
  if (!win) return null;
  return win.end - (Number(durationMins) || 0) / 60;
}

/** "12:00pm–3:00pm" when the window is usable, else "Flexible". */
export function availabilityLabel(raw, win) {
  if (!win) return String(raw || '').trim() || 'Flexible';
  return `${labelOf(win.start)}–${labelOf(win.end)}`;
}

function labelOf(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}