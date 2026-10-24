/**
 * Pure helpers that decide which outbox row is THE row for an idempotency key.
 * The entity layer has no unique constraint, so when two writers race, both rows
 * exist for a moment. The oldest (created_date, then id) is canonical; every
 * other row must never be sent. Used by the enqueue step (loser cleans up) and
 * by the sweep (a non-canonical row is suppressed instead of sent).
 */
export const byAge = (a: any, b: any): number => {
  const ta = String(a?.created_date || '');
  const tb = String(b?.created_date || '');
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a?.id) < String(b?.id) ? -1 : 1;
};

/** True when `item` is the oldest row among itself and its same-key siblings. */
export function isCanonicalRow(item: any, siblings: any[]): boolean {
  const all = [...(siblings || []).filter(r => r?.id !== item?.id), item];
  return [...all].sort(byAge)[0]?.id === item?.id;
}