import { validatePlacement, loadPlacementContext, evaluatePlacement } from './schedulingValidator.ts';

/**
 * Re-validate a placement against live data immediately before it is saved.
 * Moved out of applyManualPlacement so the AI assistant re-checks an accepted slot
 * with exactly the same two steps:
 *
 *   1. the full shared validator (validatePlacement) on fresh data;
 *   2. a second fresh read taken right before the write, re-checking only the
 *      overlap family, so a racing placement can never be written over.
 *
 * Returns which stage stopped it (or 'ok'); the caller decides what to record
 * and say. Nothing is written here.
 */
export async function revalidatePlacement(
  admin: any,
  { booking, date, barberId, start, options }: { booking: any; date: string; barberId: string | null; start: number; options: any },
): Promise<
  | { stage: 'invalid'; result: any }
  | { stage: 'raced'; result: any; race: any; raceCodes: string[] }
  | { stage: 'ok'; result: any }
> {
  const result = await validatePlacement(admin, { booking, date, barberId, start, options });
  if (!result.valid) return { stage: 'invalid', result };

  // ── Concurrency guard 2: the slot must still be free right now ───────────
  // A fresh read taken immediately before the write; only the overlap family
  // is re-checked here (travel and coverage were validated microseconds ago on
  // unchanged addresses), so a racing placement can never be written over.
  const fresh = await loadPlacementContext(admin, { booking, date, barberId });
  const race = evaluatePlacement(fresh, start, {
    source: options?.source || 'manual',
    travel: { available: true, reason: null, mins: () => 0 },
  });
  const raceCodes = (race.codes || []).filter((c: string) =>
    c === 'APPOINTMENT_OVERLAP' || c === 'PROTECTED_APPOINTMENT' || c === 'BREAK_CONFLICT');
  if (raceCodes.length > 0) return { stage: 'raced', result, race, raceCodes };
  return { stage: 'ok', result };
}