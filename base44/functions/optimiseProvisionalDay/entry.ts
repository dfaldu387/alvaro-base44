import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { withHeartbeat } from '../../shared/jobHeartbeat.ts';
import { optimiseDay, MIN_COMBINED_SAVED_MINUTES } from '../../shared/routeFlowOptimiser.ts';
import { excludeTestQuery } from '../../shared/testData.ts';
import { holdIfFinalised } from '../../shared/finalisedDayGate.ts';

/**
 * Route Flow — Optimise Provisional Day (Stage 2).
 *
 * The server-side entry point for automatic reshuffling. Triggered by the Route
 * Flow workflow whenever a booking request is created, changed or removed, so it
 * runs with no browser, no calendar page and no admin click; an administrator
 * may also invoke it directly (and may ask for a dry run).
 *
 * Authority is resolved BEFORE any settings read, day load or Mapbox call. The
 * work itself lives in the shared Stage 2 engine (shared/routeFlowOptimiser),
 * which composes:
 *
 *   reshuffleEngine     — searches for a lower-drive, lower-idle arrangement
 *   schedulingValidator — Stage 0 validation of EVERY proposed time
 *   mapboxTravel        — real road times, including the barber's first leg
 *   placementAudit      — the decision trail
 *
 * Nothing happens unless Route Flow is enabled in auto-optimise mode, the
 * improvement is worth at least 10 minutes of driving and idle time combined,
 * and the complete plan passes validation. Partial reshuffles are impossible.
 */

/** Bounded sweep when no specific booking or date is named. */
const MAX_TARGETS_PER_RUN = 10;

async function resolveTargets(admin: any, body: any) {
  // 1. A specific booking (how the workflow always calls it).
  if (body.booking_request_id) {
    let booking: any = null;
    try {
      booking = await admin.entities.BookingRequest.get(body.booking_request_id);
    } catch {
      booking = null;
    }
    if (!booking) return { error: 'booking not found' };
    if (!booking.requested_date) return { targets: [] };
    return {
      targets: [{
        date: booking.requested_date,
        teamMemberId: booking.team_member_id || '',
        isTest: booking.is_test === true,
      }],
    };
  }

  // 2. An explicit date (admin).
  if (body.date) {
    return {
      targets: [{
        date: body.date,
        teamMemberId: body.team_member_id || '',
        isTest: body.is_test === true,
      }],
    };
  }

  // 3. Sweep: every production day that still holds provisional appointments.
  const rows = await admin.entities.BookingRequest.filter(
    { schedule_status: 'provisional', ...excludeTestQuery() },
    '-created_date',
    300,
  );
  const seen = new Map<string, any>();
  for (const r of rows || []) {
    if (!r.requested_date) continue;
    const key = `${r.requested_date}|${r.team_member_id || ''}`;
    if (!seen.has(key)) seen.set(key, { date: r.requested_date, teamMemberId: r.team_member_id || '', isTest: false });
  }
  return { targets: Array.from(seen.values()).slice(0, MAX_TARGETS_PER_RUN) };
}

// Records a heartbeat for each workflow-triggered run (jobHeartbeat: 'reshuffle').
export default async function (req) {
  // Shares the 'reshuffle' heartbeat with the suggest step; its own "not in auto-optimise mode" skip is not recorded.
  return withHeartbeat(req, 'reshuffle', handle, (r) => createClientFromRequest(r).asServiceRole, { ignoreSkipped: true });
}

async function handle(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Shared authority gate first — before settings, bookings or Mapbox.
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;

    let body = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }

    // Stage 2 only runs while Route Flow is in auto-optimise mode.
    const settingsList = await admin.entities.SchedulingBotSettings.list('-created_date', 1);
    const settings = (settingsList || [])[0];
    if (!settings || !settings.enabled || settings.mode !== 'auto_optimise') {
      return Response.json({
        skipped: true,
        reason: 'route_flow_not_optimising',
        results: [],
        checked_by: actor.name,
      });
    }

    const resolved = await resolveTargets(admin, body);
    if (resolved.error) return Response.json({ error: resolved.error }, { status: 404 });
    const targets = resolved.targets || [];
    if (targets.length === 0) {
      return Response.json({ evaluated: 0, applied: 0, results: [] });
    }

    const dryRun = body.dry_run === true;
    const results = [];
    for (const target of targets) {
      // Automation never rearranges a finalised day; a person (admin) still can.
      const held = actor.automation ? await holdIfFinalised(admin, target) : null;
      if (held) {
        results.push({ date: target.date, team_member_id: target.teamMemberId || '', applied: false, dry_run: dryRun, moved_count: 0, ...held });
        continue;
      }
      results.push(await optimiseDay(admin, target, {
        dryRun,
        actorName: actor.automation ? 'Route Flow workflow' : actor.name,
        actorRole: actor.automation ? 'automation' : 'admin',
        trigger: actor.automation ? 'automation' : 'admin_panel',
      }));
    }

    return Response.json({
      evaluated: results.length,
      applied: results.filter(r => r.applied).length,
      moved_count: results.reduce((sum, r) => sum + (r.moved_count || 0), 0),
      threshold_minutes: MIN_COMBINED_SAVED_MINUTES,
      dry_run: dryRun,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}