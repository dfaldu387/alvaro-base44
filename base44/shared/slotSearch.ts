import { loadPlacementContext, buildTravelIndex, evaluatePlacement, pointOf } from './schedulingValidator.ts';
import { generateCandidateSlots, summariseNoSlotReason, blockingCodes } from './routeFlowCandidates.ts';
import { scoreCandidate, rankCandidates } from './routeFlowScoring.ts';

/**
 * Valid times for one booking on one date — read-only.
 *
 * The Route Flow pipeline run without writing anything: the same candidate
 * generator, the same shared validator, the same travel index and the same
 * scoring. Moved out of suggestPlacementSlots so the AI assistant offers slots
 * from the very same code (the endpoint is admin-only and cannot be called from
 * the inbound-SMS flow).
 *
 * `minGapMinutes` thins the ranked list so the options are not five minutes
 * apart: 15 for the admin picker, wider for a customer-facing offer.
 */
export async function findValidSlots(
  admin: any,
  { booking, date, barberId, limit = 8, minGapMinutes = 15 }: {
    booking: any; date: string; barberId: string | null; limit?: number; minGapMinutes?: number;
  },
) {
  const ctx = await loadPlacementContext(admin, { booking, date, barberId });

  // One Mapbox matrix covers every candidate below.
  const travel = await buildTravelIndex(ctx, pointOf(booking), { include_start_location: true });
  const slots = generateCandidateSlots(ctx);
  const evaluated = slots.map((slot: any) => ({
    slot,
    result: evaluatePlacement(ctx, slot.start, { source: 'route_flow', travel }),
  }));

  const valid = evaluated.filter((e: any) => e.result.valid);
  const ranked = valid.length > 0
    ? rankCandidates(valid.map((e: any) => scoreCandidate(ctx, e.result)))
    : [];
  const results = evaluated.map((e: any) => e.result);

  // Offering the admin eight slots five minutes apart helps nobody, so the
  // ranked list is thinned to options at least `minGapMinutes` apart. Any other time
  // is still available through the time picker — and still validated.
  const MIN_GAP_HOURS = minGapMinutes / 60;
  const suggestions: any[] = [];
  for (const score of ranked) {
    const last = suggestions[suggestions.length - 1];
    if (last && score.start - last.start < MIN_GAP_HOURS - 1e-9) continue;
    suggestions.push(score);
    if (suggestions.length >= limit) break;
  }

  return {
    ctx,
    evaluated,
    valid,
    ranked,
    suggestions,
    // Why nothing fitted, in the same words Route Flow records on the request.
    reason: ranked.length > 0 ? null : summariseNoSlotReason(results, ctx),
    blocking_codes: ranked.length > 0 ? [] : blockingCodes(results),
  };
}