import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { weekdayNameOf } from '../../shared/bookingWindow.ts';
import { decimalToLabel } from '../../shared/provisionalPlacement.ts';

/**
 * Edit or remove a Block Time row (Lunch, Personal, Unavailable …) on the Calendar.
 *
 * A block is an ordinary BookingRequest row: `client_name = "[BLOCK] Lunch"`, a real
 * date, an assigned start time and a duration. It is never a client appointment, so
 * this endpoint refuses to touch one — removing a block frees the time, while a real
 * booking is cancelled or removed through its own path.
 *
 * A block that belongs to a repeating series (AppointmentSeries) can be changed or
 * removed for this occurrence only, this and future occurrences, or the whole series.
 * The scope is always explicit: one click can never wipe out every future block.
 *
 * Nothing is written when it would put two things in the same slot, so an edit never
 * fails silently: the caller always gets `saved: true` or a plain-language error.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESOLVED = ['declined', 'cancelled', 'completed', 'no_show'];
const SCOPES = ['this', 'future', 'series'];

function isBlockRow(row: any) {
  return !!row && (String(row.client_name || '').startsWith('[BLOCK]') || row.status === 'blocked');
}

/** "12:00pm" / "14:30" / "2pm" → decimal hour, or null. */
function parseTime(value: any): number | null {
  const s = String(value ?? '').toLowerCase().replace(/\s/g, '');
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3] === 'pm' && h !== 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  const dec = h + Number(m[2] || 0) / 60;
  return Number.isFinite(dec) ? dec : null;
}

function labelOf(row: any) {
  return String(row?.client_name || '').startsWith('[BLOCK]')
    ? 'blocked time'
    : (row?.client_name || 'an appointment');
}

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const admin = base44.asServiceRole;

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const action = String(body?.action || '').trim();
    if (!['update', 'delete'].includes(action)) {
      return Response.json({ error: 'Unknown action.' }, { status: 400 });
    }
    const bookingId = String(body?.booking_request_id || '').trim();
    if (!bookingId) return Response.json({ error: 'A blocked time is required.' }, { status: 400 });

    let row: any = null;
    try { row = await admin.entities.BookingRequest.get(bookingId); } catch { row = null; }
    if (!row) {
      return Response.json({ error: 'That blocked time no longer exists — refresh the calendar.' }, { status: 404 });
    }
    if (!isBlockRow(row)) {
      return Response.json({
        error: 'That is a client appointment, not blocked time. Use the appointment’s own menu to change or cancel it.',
      }, { status: 400 });
    }

    // ── Which rows this action applies to ────────────────────────────────────
    // A block with no series is only ever itself; the scope is asked for only when
    // the block genuinely repeats.
    let series: any = null;
    try {
      const seriesRows = await admin.entities.AppointmentSeries.list('-created_date', 200);
      series = (seriesRows || []).find((s: any) =>
        Array.isArray(s.booking_request_ids) && s.booking_request_ids.includes(row.id)) || null;
    } catch { series = null; }

    const requestedScope = String(body?.scope || 'this');
    const scope = series && SCOPES.includes(requestedScope) ? requestedScope : 'this';

    let targets: any[] = [row];
    if (series && scope !== 'this') {
      const ids: string[] = Array.isArray(series.booking_request_ids) ? series.booking_request_ids : [];
      const rows = await Promise.all(ids.map((id: string) =>
        id === row.id ? Promise.resolve(row) : admin.entities.BookingRequest.get(id).catch(() => null)));
      const found = rows.filter(Boolean);
      targets = scope === 'series'
        ? found
        : found.filter((r: any) => String(r.requested_date || '') >= String(row.requested_date || ''));
      if (targets.length === 0) targets = [row];
    }
    const targetIds = new Set(targets.map((r: any) => r.id));

    // ── Update ───────────────────────────────────────────────────────────────
    if (action === 'update') {
      // A caller that only moves the block (a drag) sends no title: its own title is kept.
      const reason = String(body?.reason ?? '').trim().slice(0, 60)
        || String(row.client_name || '').replace(/^\[BLOCK\]\s*/i, '').trim()
        || (Array.isArray(row.services) ? String(row.services[0] || '') : '')
        || 'Blocked time';

      const start = Number(body?.start);
      const end = Number(body?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 24 || end <= start) {
        return Response.json({ error: 'The end time must be after the start time.' }, { status: 400 });
      }

      const notes = body?.notes === undefined ? undefined : String(body.notes || '').slice(0, 500);

      // A single block can move to another date. A repeating block keeps each
      // occurrence on its own date — only its time, title and notes change.
      let newDate: string | null = null;
      if (targets.length === 1 && body?.requested_date) {
        const candidate = String(body.requested_date);
        if (!DATE.test(candidate)) return Response.json({ error: 'That date is not valid.' }, { status: 400 });
        newDate = candidate;
      }

      // ── Never double-book: the new time must be free on every affected date ──
      const dates = [...new Set(targets.map((r: any) => newDate || String(r.requested_date || '')))].filter(Boolean);
      for (const date of dates) {
        let dayRows: any[] = [];
        try { dayRows = await admin.entities.BookingRequest.filter({ requested_date: date }, '-created_date', 200); } catch { dayRows = []; }
        for (const other of (dayRows || [])) {
          if (targetIds.has(other.id) || RESOLVED.includes(other.status)) continue;
          const otherStart = parseTime(other.assigned_time);
          if (otherStart == null) continue;
          const otherEnd = otherStart + (Number(other.duration_mins) || 0) / 60;
          if (otherStart < end && otherEnd > start) {
            return Response.json({
              error: `${decimalToLabel(start)}–${decimalToLabel(end)} on ${date} overlaps ${labelOf(other)} at ${other.assigned_time}.`,
              code: 'BLOCK_CONFLICT',
            }, { status: 409 });
          }
        }
      }

      const patch = (date: string | null) => ({
        client_name: `[BLOCK] ${reason}`,
        services: [reason],
        duration_mins: Math.round((end - start) * 60),
        availability_window: `${decimalToLabel(start)}–${decimalToLabel(end)}`,
        assigned_time: decimalToLabel(start),
        ...(notes !== undefined ? { notes } : {}),
        ...(date ? { requested_date: date, day: weekdayNameOf(date) } : {}),
      });

      const saved: string[] = [];
      for (const target of targets) {
        const date = (targets.length === 1 ? newDate : null);
        try {
          await admin.entities.BookingRequest.update(target.id, patch(date));
          saved.push(target.id);
        } catch { /* counted below, never reported as a success */ }
      }
      if (saved.length !== targets.length) {
        return Response.json({
          saved: saved.length > 0,
          updated: saved.length,
          error: saved.length === 0
            ? 'The block could not be saved. Please try again.'
            : 'Some of the repeating blocks could not be saved. Please check the series.',
        }, { status: saved.length === 0 ? 500 : 207 });
      }

      try {
        await admin.entities.ActivityLog.create({
          action: 'block_time_edited',
          actor: 'barber',
          summary: `Blocked time changed to ${reason} ${decimalToLabel(start)}–${decimalToLabel(end)}`.slice(0, 200),
          detail: `${saved.length} block${saved.length === 1 ? '' : 's'} updated · scope ${scope} · by ${actor.name}`.slice(0, 400),
          related_record_id: row.id,
          related_record_type: 'BookingRequest',
          timestamp: new Date().toISOString(),
        });
      } catch { /* an audit failure never changes the edit */ }

      return Response.json({ saved: true, updated: saved.length, scope, repeating: !!series });
    }

    // ── Delete ───────────────────────────────────────────────────────────────
    // The row is removed outright, so the time is immediately free for scheduling
    // again — a block never lingers as a half-scheduled record.
    const removed: string[] = [];
    for (const target of targets) {
      try {
        await admin.entities.BookingRequest.delete(target.id);
        removed.push(target.id);
      } catch { /* counted below */ }
    }
    if (removed.length !== targets.length) {
      return Response.json({
        saved: false,
        removed: removed.length,
        error: 'Some of those blocks could not be removed. Please refresh the calendar and try again.',
      }, { status: 500 });
    }

    if (series) {
      const remaining = (series.booking_request_ids || []).filter((id: string) => !removed.includes(id));
      try {
        if (remaining.length > 0) {
          await admin.entities.AppointmentSeries.update(series.id, {
            booking_request_ids: remaining,
            occurrences_created: remaining.length,
          });
        } else {
          await admin.entities.AppointmentSeries.delete(series.id);
        }
      } catch { /* the blocks themselves are already gone; the series is only a label */ }
    }

    try {
      await admin.entities.ActivityLog.create({
        action: 'block_time_removed',
        actor: 'barber',
        summary: `${removed.length} blocked time${removed.length === 1 ? '' : 's'} removed — the time is free again`.slice(0, 200),
        detail: `scope ${scope} · by ${actor.name}`.slice(0, 400),
        related_record_id: row.id,
        related_record_type: 'BookingRequest',
        timestamp: new Date().toISOString(),
      });
    } catch { /* an audit failure never changes the removal */ }

    return Response.json({ saved: true, removed: removed.length, scope, repeating: !!series });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'The block could not be changed.' }, { status: 500 });
  }
}