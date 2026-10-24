/**
 * What a customer would notice when an admin edits a CONFIRMED booking. Pure: no database, no messages.
 *
 * Customer-visible (these four, and only these):
 *   service  - the set of services booked (order and capitalisation are not news)
 *   price    - the total, compared in whole cents
 *   window   - the availability window (spacing, dash style and capitalisation are not news)
 *   address  - the service address (punctuation, spacing and capitalisation are not news)
 * Not visible, never a text: name, phone, email, notes, and anything internal (duration, zone, tier).
 *
 * The result names each change in the customer's words. A booking that was not confirmed, or is
 * already finished, yields null: only a confirmed booking has been promised something.
 */
const RESOLVED = ['declined', 'cancelled', 'completed', 'no_show', 'could_not_fit', 'blocked'];

const flat = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const win = (s: unknown) => String(s ?? '').toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, '');
const names = (b: any): string[] => (Array.isArray(b?.services) ? b.services : []).map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
const cents = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));

export interface EditNotice { change: string; fields: string[]; hash: string }

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const joinNice = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

export function bookingEditNotice(before: any, after: any): EditNotice | null {
  if (!before || !after) return null;
  if (before.status !== 'confirmed' || RESOLVED.includes(String(after.status))) return null;

  const parts: string[] = [];
  const fields: string[] = [];
  const state: string[] = [];

  const sb = names(before).map(flat).sort().join('|');
  const sa = names(after).map(flat).sort().join('|');
  if (sa && sb !== sa) { fields.push('service'); parts.push(`service is now ${names(after).join(', ')}`); state.push(`s:${sa}`); }

  const pb = cents(before.price); const pa = cents(after.price);
  if (pa !== null && pb !== pa) { fields.push('price'); parts.push(`price is now $${(pa / 100).toFixed(2)}`); state.push(`p:${pa}`); }

  const wb = win(before.availability_window); const wa = win(after.availability_window);
  if (wa && wb !== wa) { fields.push('window'); parts.push(`window is now ${String(after.availability_window).trim()}`); state.push(`w:${wa}`); }

  const ab = flat(before.address); const aa = flat(after.address);
  if (aa && ab !== aa) { fields.push('address'); parts.push(`address is now ${String(after.address).trim()}`); state.push(`a:${aa}`); }

  if (parts.length === 0) return null;
  return { change: joinNice(parts), fields, hash: hash(state.join(';')) };
}