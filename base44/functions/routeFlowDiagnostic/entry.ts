import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import {
  loadPlacementContext,
  buildTravelIndex,
  evaluatePlacement,
  pointOf,
  DEAD_STATUSES,
} from '../../shared/schedulingValidator.ts';
import { generateCandidateSlots } from '../../shared/routeFlowCandidates.ts';
import { decimalToLabel } from '../../shared/provisionalPlacement.ts';

/**
 * Route Flow Diagnostic — READ ONLY.
 *
 * Answers "why can't this be placed?" with evidence instead of a guess. For a
 * given date it takes every unresolved request and runs the REAL engine path:
 *
 *   generateCandidateSlots  → the exact times Route Flow would test
 *   evaluatePlacement       → the authoritative validator, per candidate
 *
 * then counts the exact rejection codes. The same candidates are re-evaluated
 * under counterfactuals (lead time ignored, provisional appointments treated as
 * movable, travel ignored) so the blocker distribution is known before any
 * scheduling rule is loosened.
 *
 * Guarantees:
 *   - No writes of any kind: no booking, request, appointment, log or audit row
 *     is created, moved, scheduled or deleted.
 *   - Reads the same shared modules the engine uses, so the diagnosis can never
 *     drift from the behaviour it explains.
 *   - Admin-only, and free of client names in anything it returns beyond the
 *     request it was asked about.
 */

const NO_TRAVEL = { available: true, reason: null, mins: () => 0 } as any;
/** The most permissive Booking Window a counterfactual can be run under. */
const NO_WINDOW = { minimum_notice_hours: 0, maximum_booking_days: 3650 };

/** Drops zero-valued entries so the report stays readable. */
function compact(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(counts || {})) if (counts[k] > 0) out[k] = counts[k];
  return out;
}

function topCode(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of Object.entries(counts || {})) {
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return best;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const admin = base44.asServiceRole;

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const date = String(body?.date || '').trim();
    if (!date) return Response.json({ error: 'date (YYYY-MM-DD) required' }, { status: 400 });
    const compactMode = body?.compact === true;
    const ids: string[] | null = Array.isArray(body?.ids) && body.ids.length ? body.ids.map(String) : null;

    const rows = await admin.entities.BookingRequest.filter({ requested_date: date }, '-created_date', 100);
    const all = rows || [];

    const targets = all.filter((r: any) =>
      !r.assigned_time &&
      (!r.schedule_status || r.schedule_status === 'unscheduled') &&
      !DEAD_STATUSES.includes(r.status) && r.status !== 'completed')
      .filter((r: any) => !ids || ids.includes(r.id));

    // Appointments Stage 2 (the reshuffle optimiser) is allowed to move.
    const provisionalIds = all.filter((r: any) => r.schedule_status === 'provisional').map((r: any) => r.id);

    const report: any[] = [];
    const tableRows: string[] = [];
    const agg = {
      total_candidates: 0,
      code_counts: {} as Record<string, number>,
      exclusive_counts: {} as Record<string, number>,
      scenario_valid: {} as Record<string, number>,
      scenario_candidates: {} as Record<string, number>,
    };

    for (const t of targets) {
      const ctx = await loadPlacementContext(admin, {
        booking: t,
        date,
        barberId: t.team_member_id || null,
      });
      // One Mapbox matrix per request — the same index the engine would build.
      const travel = await buildTravelIndex(ctx, pointOf(t), { include_start_location: true });
      const slots = generateCandidateSlots(ctx);
      const atAttempt = t.created_date ? new Date(t.created_date).getTime() : Date.now();

      // Counterfactuals. The Booking Window scenarios simulate a *different
      // setting* rather than overriding the rule — automation has no override,
      // so the only honest way to ask "what if minimum notice were 0?" is to
      // re-run the real rule with that window in force.
      const scenarios: Record<string, any> = {
        engine_when_it_tried: { now: atAttempt },
        engine_now: { now: Date.now() },
        notice_open: { now: atAttempt, booking_window: NO_WINDOW },
        provisional_treated_movable: { now: atAttempt, ignore: provisionalIds },
        notice_open_and_provisional_movable: { now: atAttempt, booking_window: NO_WINDOW, ignore: provisionalIds },
        ignore_travel_too: { now: atAttempt, booking_window: NO_WINDOW, ignore: provisionalIds, no_travel: true },
      };

      const scenarioResults: Record<string, any> = {};
      for (const [name, cfg] of Object.entries(scenarios)) {
        const codeCounts: Record<string, number> = {};
        const exclusive: Record<string, number> = {};
        let valid = 0;
        let nearest: any = null;
        const scenarioCtx = cfg.booking_window ? { ...ctx, booking_window: cfg.booking_window } : ctx;

        for (const slot of slots) {
          const res: any = evaluatePlacement(scenarioCtx, slot.start, {
            source: 'route_flow',
            travel: cfg.no_travel ? NO_TRAVEL : travel,
            now: cfg.now,
            ignore_appointment_ids: cfg.ignore || [],
          });
          const codes = res.codes || [];
          if (res.valid) valid += 1;
          for (const c of codes) codeCounts[c] = (codeCounts[c] || 0) + 1;
          if (codes.length === 1) exclusive[codes[0]] = (exclusive[codes[0]] || 0) + 1;

          // Nearest valid-looking candidate: fewest blockers, then earliest.
          if (!res.valid && (!nearest || codes.length < nearest.codes.length ||
            (codes.length === nearest.codes.length && slot.start < nearest.start))) {
            nearest = {
              start: slot.start,
              label: decimalToLabel(slot.start),
              codes,
              message: String((res.violations || [])[0]?.message || '').slice(0, 160),
            };
          }
        }

        scenarioResults[name] = {
          candidates: slots.length,
          valid,
          code_counts: compact(codeCounts),
          exclusive_counts: compact(exclusive),
          nearest_invalid: nearest,
        };
        agg.scenario_valid[name] = (agg.scenario_valid[name] || 0) + valid;
        agg.scenario_candidates[name] = (agg.scenario_candidates[name] || 0) + slots.length;
      }

      // The outcome the engine actually reached when it first tried.
      const primary = scenarioResults.engine_when_it_tried;
      for (const [code, count] of Object.entries(primary.code_counts)) {
        agg.code_counts[code] = (agg.code_counts[code] || 0) + (count as number);
      }
      for (const [code, count] of Object.entries(primary.exclusive_counts)) {
        agg.exclusive_counts[code] = (agg.exclusive_counts[code] || 0) + (count as number);
      }
      agg.total_candidates += slots.length;

      const ordered = Object.entries(primary.code_counts).sort((a, b) => (b[1] as number) - (a[1] as number));

      const entry: any = {
        id: t.id,
        client: t.client_name,
        booking_source: t.booking_source || null,
        window: ctx.window_raw,
        service_minutes: ctx.service_minutes,
        calendar_minutes: ctx.calendar_minutes,
        buffer_minutes: ctx.buffer_minutes,
        work: { status: ctx.work.status, source: ctx.work.source, normal: ctx.work.normal },
        booking_window: ctx.booking_window,
        coverage_tier: ctx.coverage?.tier ?? null,
        start_location_configured: ctx.start_location?.configured === true,
        travel_available: travel.available,
        travel_reason: travel.reason || null,
        drive_legs_on_day: (ctx.drive_legs || []).length,
        occupied: (ctx.occupied || []).map((o: any) => ({
          label: o.label, kind: o.kind, protection: o.protection,
          time: `${decimalToLabel(o.start)}–${decimalToLabel(o.occupied_end)}`,
        })),
        candidates: slots.length,
        main_blocker: topCode(primary.code_counts),
        other_blockers: ordered.slice(1).map(([c, n]) => `${c}×${n}`),
        stored_reason: t.placement_reason || null,
        context_errors: ctx.errors,
        settings_warnings: ctx.settings_warnings,
        occupied_summary: (() => {
          const counts: Record<string, number> = {};
          for (const o of (ctx.occupied || [])) {
            const key = `${o.kind}/${o.protection}`;
            counts[key] = (counts[key] || 0) + 1;
          }
          return Object.entries(counts).map(([k, n]) => `${k}×${n}`).join(', ') || 'none';
        })(),
        scenarios: scenarioResults,
      };

      // Compact mode keeps the decision-relevant fields only, so the whole
      // distribution for a day fits in one readable report.
      if (compactMode) {
        // One dense line per request: client | candidates | valid | main blocker |
        // other blockers | nearest invalid slot | valid-if-loosened | valid-with-
        // lead-time-open | valid-with-provisional-movable | valid-without-travel
        const loosened = scenarioResults.notice_open_and_provisional_movable;
        tableRows.push([
          t.client_name,
          String(slots.length),
          String(primary.valid),
          entry.main_blocker || 'none',
          (entry.other_blockers || []).join(', ') || 'none',
          primary.nearest_invalid ? `${primary.nearest_invalid.label} ${primary.nearest_invalid.codes.join('+')}` : 'none',
          String(loosened.valid),
          String(scenarioResults.notice_open.valid),
          String(scenarioResults.provisional_treated_movable.valid),
          String(scenarioResults.ignore_travel_too.valid),
          ctx.errors.length ? `CTX: ${ctx.errors.join(' ')}` : 'ctx ok',
        ].join(' | '));
      } else {
        report.push(entry);
      }
    }

    return Response.json({
      date,
      run_at: new Date().toISOString(),
      read_only: true,
      unresolved_requests: targets.length,
      provisional_appointments_on_day: provisionalIds.length,
      aggregate: compactMode ? undefined : agg,
      requests: compactMode ? undefined : report,
      rows: compactMode
        ? ['client | candidates | valid | main | others | nearest | valid_if_loosened | valid_notice_open | valid_prov_movable | valid_no_travel | ctx', ...tableRows]
        : undefined,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}