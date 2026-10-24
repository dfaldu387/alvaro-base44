/**
 * Australian phone + email normalisation — the ONE place customer matching keys
 * are built, shared by submitPublicBooking, checkBookingStatus and client matching.
 *
 * Standard form: national format with the leading zero and no separators,
 * e.g. "0412345678". All of these normalise to it:
 *   "0412 345 678", "0412-345-678", "(04) 1234 5678", "+61 412 345 678",
 *   "+61 (0)412 345 678", "61412345678", "0061 412 345 678".
 *
 * Limitations (deliberate):
 *   - Only Australian numbers are supported: a 9-digit national number starting
 *     2, 3, 4, 7 or 8 (mobiles are 04xx; landlines 02/03/07/08).
 *   - Numbers with any other country code (e.g. +64, +1) return null. They are
 *     never rewritten, so they can never collide with an Australian number.
 *   - Short, malformed or letter-containing input returns null. Callers must
 *     treat null as "cannot match", never as an empty-string key.
 *   - Extensions and 13xx/1300/1800 numbers are not supported.
 *   - A leading apostrophe (spreadsheet-import artifact) is ignored.
 */

const AU_LEADING_DIGITS = ['2', '3', '4', '7', '8'];

/** "0412345678" for a supported Australian number, otherwise null. */
export function normaliseAuPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  // Spreadsheet imports leave a leading apostrophe on stored phones ("'+61478…");
  // it is not part of the number, so it is ignored.
  const s = String(raw).trim().replace(/^['’`]+/, '').trim();
  if (s === '') return null;
  // Only separators may sit between digits; anything else (letters etc.) is rejected.
  if (!/^\+?[\d\s\-().]+$/.test(s)) return null;

  const plus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  let national: string;

  if (plus) {
    if (!digits.startsWith('61')) return null;
    national = digits.slice(2);
  } else if (digits.startsWith('0061')) {
    national = digits.slice(4);
  } else if (digits.startsWith('61') && digits.length >= 11) {
    national = digits.slice(2);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    return null;
  }

  // "+61 (0)412..." keeps a trunk zero after the country code.
  if (national.length === 10 && national.startsWith('0')) national = national.slice(1);

  if (national.length !== 9 || !AU_LEADING_DIGITS.includes(national[0])) return null;
  return `0${national}`;
}

/** Trimmed, lower-cased email, or null when blank. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e === '' ? null : e;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Server-side regex that finds stored phones written in ANY separator style
 * ("0412 345 678", "0412-345-678", "+61412345678"). It only narrows the query;
 * callers must still confirm each hit with normaliseAuPhone().
 */
export function auPhoneSearchPattern(normalised: string): string {
  return normalised.slice(1).split('').join('\\D*') + '\\D*$';
}