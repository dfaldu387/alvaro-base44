import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { mapboxDriveMatrix } from '../../shared/mapboxTravel.ts';
import { evaluateSchedule } from '../../shared/reshuffleEngine.ts';
// Route Flow reporting ignores test activity — test bookings are never part of
// an evaluation, a suggestion or its metrics.
import { excludeTestQuery } from '../../shared/testData.ts';
import { parseWindow, parseTimeStr, isAutomationAllowed } from '../../shared/provisionalPlacement.ts';
import { readStartLocation } from '../../shared/schedulingValidator.ts';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { withHeartbeat } from '../../shared/jobHeartbeat.ts';
import { recordRouteFlowActivity, movesForDetail, scheduleDateLabel } from '../../shared/routeFlowActivity.ts';

/**
 * Route Flow — Reshuffle Evaluation (V2). Evaluate only, never applies.
 *
 * Runs when Route Flow is in 'suggest' mode. The caller is authorised by the
 * shared gate (administrator, or the platform's trusted workflow identity)
 * before any load or Mapbox work. Loads a day's appointments for one barber,
 * treats Locked / Confirmed / overridden / blocked appointments as immovable
 * anchors, and searches for a better arrangement of the Provisional
 * appointments — respecting customer availability, service duration, normal
 * barber hours, overlaps and cancelled appointments.
 *
 * Travel time is calculated in the background for evaluation only. No permanent
 * drive blocks are created and nothing is written back to the calendar.
 *
 * A suggestion is stored for admin review only when it is meaningfully better.
 */

const ACTIVE_EXCLUDED = ['declined', 'no_show', 'completed', 'could_not_fit'];
const MAX_GROUPS_PER_RUN = 10;

const dateForDay = (day: string): string => {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const target = names.indexOf(day);
  if (target < 0) return '';
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((target - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
};

// Road travel estimates come from the shared travel module, so the reshuffle
// engine and the scheduling validator always judge the same journeys.
async function fetchDriveMatrix(coords: number[][]): Promise<number[][] | null> {
  const result = await mapboxDriveMatrix(coords.map(c => ({ lat: c[0], lng: c[1] })));
  return result.durations || null;
}

/** Normal working hours for the day — special hours override the weekly pattern. */
async function resolveWorkingHours(admin, teamMemberId: string, day: string, dateStr: string) {
  if (teamMemberId) {
    try {
      const member = await admin.entities.TeamMember.get(teamMemberId);
      const name = member?.name || '';
      // Where this barber's day begins — the origin of the first leg.
      const startLocation = readStartLocation(member);
      const special = (member?.special_hours || []).find(s => s.date === dateStr);
      if (special) {
        if (!special.is_open) return { working: false, name, startLocation };
        return { working: true, name, startLocation, workStart: special.open_time ?? 9, workEnd: special.close_time ?? 17 };
      }
      const dayHours = (member?.working_hours || []).find(h => h.day_of_week === day);
      if (dayHours) {
        if (!dayHours.is_open) return { working: false, name, startLocation };
        return { working: true, name, startLocation, workStart: dayHours.open_time ?? 9, workEnd: dayHours.close_time ?? 17 };
      }
      return { working: true, name, startLocation, workStart: 9, workEnd: 17 };
    } catch {
      // fall through to business hours
    }
  }

  try {
    const rows = await admin.entities.BusinessHours.filter({ day_of_week: day });
    const entry = (rows || []).find(r => !r.team_member_id);
    if (entry) {
      if (!entry.is_open) return { working: false, name: '', startLocation: null };
      return { working: true, name: '', startLocation: null, workStart: entry.open_time ?? 9, workEnd: entry.close_time ?? 17 };
    }
  } catch {
    // fall back to defaults
  }
  return { working: true, name: '', startLocation: null, workStart: 9, workEnd: 17 };
}

/**
 * A suggestion is Route Flow's proposal, never its decision: in Suggest mode it
 * applies nothing, so the proposal is recorded as activity awaiting the admin.
 * Writing this note changes no scheduling behaviour.
 */
async function noteSuggestionActivity(admin, entry) {
  const moveCount = (entry.moves || []).length;
  await recordRouteFlowActivity(admin, {
    event_type: 'suggestion_created',
    summary: `Route Flow suggested a reshuffle for ${entry.day} ${scheduleDateLabel(entry.date)}`.trim(),
    detail: [
      `${moveCount} appointment${moveCount === 1 ? '' : 's'} would move`,
      `Drive: ${entry.driveBefore} → ${entry.driveAfter} min`,
      `Idle: ${entry.idleBefore} → ${entry.idleAfter} min`,
      '0 protected appointments moved',
      entry.updated ? 'suggestion updated · awaiting review' : 'awaiting admin review',
    ].join(' · '),
    schedule_date: entry.date,
    actor_type: 'route_flow',
    trigger_type: 'automation',
    outcome: 'pending_review',
    bookings_evaluated: entry.evaluatedCount,
    appointments_moved: 0,
    requests_placed: 0,
    requests_unscheduled: 0,
    protected_moved: 0,
    drive_before: entry.driveBefore,
    drive_after: entry.driveAfter,
    idle_before: entry.idleBefore,
    idle_after: entry.idleAfter,
    reason_code: 'awaiting_review',
    reason_text: 'Suggest mode never applies automatically — the suggestion waits for an administrator.',
    related_record_id: entry.suggestionId || null,
    details: {
      barber_name: entry.teamName || null,
      signature: entry.signature || null,
      suggestion_id: entry.suggestionId || null,
      updated: entry.updated === true,
      would_move_count: moveCount,
      would_be: true,
      moves: entry.moves || [],
    },
  });
}

async function evaluateGroup(admin, day: string, teamMemberId: string, exactDate?: string) {
  const dateStr = exactDate || dateForDay(day);
  const hours = await resolveWorkingHours(admin, teamMemberId, day, dateStr);
  if (!hours.working) return { day, date: dateStr, skipped: 'barber_not_working' };

  // Scheduling is date-bound — only this exact date's appointments are evaluated
  let dayBookings = [];
  try {
    dayBookings = await admin.entities.BookingRequest.filter({ requested_date: dateStr, ...excludeTestQuery() }, '-created_date', 300);
  } catch {
    return { day, date: dateStr, skipped: 'load_failed' };
  }

  const items = [];
  for (const r of dayBookings || []) {
    if (ACTIVE_EXCLUDED.includes(r.status)) continue;
    if (teamMemberId && r.team_member_id && r.team_member_id !== teamMemberId) continue;

    const start = r.assigned_time ? parseTimeStr(r.assigned_time) : NaN;
    const placed = !isNaN(start);
    const durationHours = (r.duration_mins || 30) / 60;
    const isBlock = (r.client_name || '').startsWith('[BLOCK]') || r.status === 'blocked';
    const win = parseWindow(r.availability_window);

    const base = {
      id: r.id,
      clientName: r.client_name || (isBlock ? 'Blocked' : 'Client'),
      durationHours,
      windowStart: win ? win.start : null,
      windowEnd: win ? win.end : null,
      lat: r.address_lat ?? null,
      lng: r.address_lng ?? null,
    };

    if (isBlock) {
      if (!placed) continue;
      items.push({ ...base, start, anchor: true, anchorReason: 'block', block: true, candidate: false });
      continue;
    }

    const movable = isAutomationAllowed(r.schedule_status) && !r.availability_override;

    if (placed) {
      items.push({
        ...base,
        start,
        anchor: !movable,
        anchorReason: movable
          ? null
          : r.availability_override
            ? 'override'
            : r.schedule_status || 'protected',
        block: false,
        candidate: false,
      });
    } else if ((!r.schedule_status || r.schedule_status === 'unscheduled') && (r.status === 'pending' || r.status === 'waitlist')) {
      items.push({ ...base, start: null, anchor: false, anchorReason: null, block: false, candidate: true });
    }
  }

  const anchors = items.filter(i => i.anchor);
  const movables = items.filter(i => !i.anchor && !i.candidate);
  if (movables.length === 0) return { day, date: dateStr, skipped: 'no_provisional_appointments' };

  // ── Background travel data (never persisted as drive blocks) ────────────
  const indexById: Record<string, number> = {};
  const coords: number[][] = [];
  // The barber's saved start location is the origin of the day's first leg, so
  // the first appointment is never judged as costing zero travel.
  const startPoint = hours.startLocation?.configured ? hours.startLocation.point : null;
  if (startPoint) {
    indexById.START = coords.length;
    coords.push([startPoint.lat, startPoint.lng]);
  }
  for (const it of items) {
    if (it.lat == null || it.lng == null) {
      indexById[it.id] = -1;
      continue;
    }
    indexById[it.id] = coords.length;
    coords.push([it.lat, it.lng]);
  }

  let durations: number[][] | null = null;
  if (coords.length >= 2 && coords.length <= 25) {
    durations = await fetchDriveMatrix(coords);
  }

  const driveFn = (fromId: string, toId: string): number | null => {
    if (!durations) return null;
    const i = indexById[fromId];
    const j = indexById[toId];
    if (i == null || j == null || i < 0 || j < 0) return null;
    const row = durations[i];
    if (!row || row[j] == null) return null;
    return row[j] / 60;
  };

  const evaluation = evaluateSchedule(items, hours.workStart, hours.workEnd, driveFn, {
    startKey: startPoint ? 'START' : null,
  });
  const signature = evaluation.changes
    .filter(c => c.moving || c.is_new)
    .map(c => `${c.booking_request_id}@${c.to_label}`)
    .sort()
    .join('|') || 'none';

  // ── Suggestion lifecycle ────────────────────────────────────────────────
  let existing = [];
  try {
    existing = await admin.entities.RouteFlowSuggestion.filter({ suggestion_date: dateStr }, '-created_date', 50);
  } catch {
    existing = [];
  }
  const forBarber = (existing || []).filter(s => (s.team_member_id || '') === (teamMemberId || ''));
  const pending = forBarber.filter(s => s.status === 'pending');
  const dismissedSame = forBarber.find(s => s.status === 'dismissed' && s.signature && s.signature === signature);

  if (!evaluation.meaningful) {
    for (const p of pending) {
      await admin.entities.RouteFlowSuggestion.update(p.id, { status: 'superseded' });
    }
    return {
      day,
      date: dateStr,
      meaningful: false,
      reason: evaluation.reason,
      current: evaluation.current,
      proposed: evaluation.proposed,
      improvement: evaluation.improvement,
      skipped: pending.length > 0 ? 'cleared' : undefined,
    };
  }

  // Don't immediately resurrect a suggestion the admin already dismissed.
  if (pending.length === 0 && dismissedSame) {
    return { day, date: dateStr, meaningful: false, reason: 'dismissed_previously' };
  }

  const payload = {
    day_of_week: day,
    suggestion_date: dateStr,
    team_member_id: teamMemberId || '',
    team_member_name: hours.name || '',
    status: 'pending',
    signature,
    current: {
      total_drive_minutes: evaluation.current.totalDriveMinutes,
      total_idle_minutes: evaluation.current.totalIdleMinutes,
      scheduled_count: evaluation.current.scheduledCount,
    },
    proposed: {
      total_drive_minutes: evaluation.proposed.totalDriveMinutes,
      total_idle_minutes: evaluation.proposed.totalIdleMinutes,
      scheduled_count: evaluation.proposed.scheduledCount,
    },
    improvement: {
      drive_minutes_saved: evaluation.improvement.driveMinutesSaved,
      idle_minutes_saved: evaluation.improvement.idleMinutesSaved,
      additional_bookings_fit: evaluation.improvement.additionalBookingsFit,
    },
    changes: evaluation.changes,
    provisional_moved_count: evaluation.changes.filter(c => !c.protected && c.moving).length,
    protected_count: evaluation.changes.filter(c => c.protected).length,
  };

  const activityBase = {
    day,
    date: dateStr,
    teamName: hours.name || '',
    // Client labels are stripped here — activity carries times, not people.
    moves: movesForDetail(evaluation.changes),
    evaluatedCount: evaluation.changes.filter(c => !c.protected).length,
    driveBefore: evaluation.current.totalDriveMinutes,
    driveAfter: evaluation.proposed.totalDriveMinutes,
    idleBefore: evaluation.current.totalIdleMinutes,
    idleAfter: evaluation.proposed.totalIdleMinutes,
    signature,
  };

  if (pending.length > 0) {
    await admin.entities.RouteFlowSuggestion.update(pending[0].id, payload);
    await noteSuggestionActivity(admin, { ...activityBase, suggestionId: pending[0].id, updated: true });
    return { day, date: dateStr, meaningful: true, updated: true, suggestion_id: pending[0].id };
  }

  const created = await admin.entities.RouteFlowSuggestion.create(payload);
  await noteSuggestionActivity(admin, { ...activityBase, suggestionId: created?.id, updated: false });
  return { day, date: dateStr, meaningful: true, created: true, suggestion_id: created?.id };
}

// Records a heartbeat for each workflow-triggered run (jobHeartbeat: 'reshuffle').
export default async function (req) {
  return withHeartbeat(req, 'reshuffle', handle, (r) => createClientFromRequest(r).asServiceRole);
}

async function handle(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Shared authority gate first — before any settings read, load or Mapbox work.
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;

    let body = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }

    // 1. Only runs while Route Flow is in 'suggest' mode
    const settingsList = await admin.entities.SchedulingBotSettings.list('-created_date', 1);
    const settings = (settingsList || [])[0];
    if (!settings || !settings.enabled || settings.mode !== 'suggest') {
      return Response.json({ skipped: true, reason: 'route_flow_not_in_suggest_mode', results: [], checked_by: actor.name });
    }

    // 2. Which (day, barber) groups to evaluate
    const groups: Array<{ day: string; date: string; teamMemberId: string }> = [];

    if (body.booking_request_id) {
      try {
        const b = await admin.entities.BookingRequest.get(body.booking_request_id);
        if (b?.day) groups.push({ day: b.day, date: b.requested_date || '', teamMemberId: b.team_member_id || '' });
      } catch {
        /* ignore */
      }
    } else if (body.day) {
      groups.push({ day: body.day, date: body.date || '', teamMemberId: body.team_member_id || '' });
    } else {
      const [provisional, unscheduled] = await Promise.all([
        admin.entities.BookingRequest.filter({ schedule_status: 'provisional', ...excludeTestQuery() }, '-created_date', 300),
        admin.entities.BookingRequest.filter({ schedule_status: 'unscheduled', ...excludeTestQuery() }, '-created_date', 300),
      ]);
      const seen = new Set();
      for (const r of [...(provisional || []), ...(unscheduled || [])]) {
        if (!r.day) continue;
        // Group by exact date — two different Fridays are two different days
        const key = `${r.requested_date || r.day}|${r.team_member_id || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        groups.push({ day: r.day, date: r.requested_date || '', teamMemberId: r.team_member_id || '' });
      }
    }

    if (groups.length === 0) {
      return Response.json({ evaluated: 0, results: [] });
    }

    const results = [];
    for (const g of groups.slice(0, MAX_GROUPS_PER_RUN)) {
      results.push(await evaluateGroup(admin, g.day, g.teamMemberId, g.date));
    }

    return Response.json({ evaluated: results.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}