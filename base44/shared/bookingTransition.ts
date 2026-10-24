import { recordAudit, finishAudit, AUDIT_REFUSED } from './auditLog.ts';
import { finishCompletion } from './routeCompletion.ts';
import { ensureRouteTemplates } from './routeMessageTemplates.ts';
import { confirmBookingCore } from './bookingMessages.ts';
import { actorOwnsBooking } from './schedulingAuth.ts';

/**
 * The one server-side path for status, lock and override changes that used to be written from the browser.
 * Completion runs the SAME lifecycle as the Route tab (shared/routeCompletion finishCompletion: status, client
 * stamp, cadence and next reminder, completion text, balance request) and also marks the stop on the day's route
 * completed, so the Route tab agrees. Each change is audited first (fail closed) and finished afterwards.
 */
export const TRANSITIONS = ['complete', 'set_status', 'lock', 'unlock', 'confirm_override', 'clear_override'] as const;
export type Transition = typeof TRANSITIONS[number];

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const CLOSED = ['declined', 'cancelled', 'no_show', 'could_not_fit', 'blocked'];
/** Targets the browser may ask for. Declined and no-show have their own endpoints (messages, counts). */
export const SETTABLE = ['pending', 'confirmed', 'waitlist', 'rescheduled'];

export interface TransitionResult { status: number; body: Record<string, unknown> }
const no = (status: number, error: string): TransitionResult => ({ status, body: { saved: false, error } });

/** Marks the booking's stop completed on its day route, if it has one. Never throws. */
async function completeStopOnRoute(admin: any, booking: any, who: string, now: string) {
  try {
    const routes = asList(await admin.entities.DayRoute.filter({ date: booking.requested_date }, '-created_date', 50));
    const route = routes.find((r: any) => (r.stops || []).some((s: any) => s.booking_request_id === booking.id));
    if (!route) return false;
    const exec: any[] = Array.isArray(route.stop_execution) ? route.stop_execution : [];
    const prev = exec.find((e) => e.booking_request_id === booking.id) || { booking_request_id: booking.id, state: 'planned' };
    if (prev.state === 'completed') return false;
    const stop = { ...prev, state: 'completed', customer_state: 'Completed', completed_at: now, updated_by: who };
    const next = exec.some((e) => e.booking_request_id === booking.id) ? exec.map((e) => (e.booking_request_id === booking.id ? stop : e)) : [...exec, stop];
    await admin.entities.DayRoute.update(route.id, { stop_execution: next });
    return true;
  } catch (e) { console.error('route stop not marked', (e as Error)?.message); return false; }
}

export async function runTransition(admin: any, actor: any, booking: any, action: string, body: any = {}): Promise<TransitionResult> {
  if (!TRANSITIONS.includes(action as Transition)) return no(400, 'Unknown action.');
  if (!actorOwnsBooking(actor, booking)) return no(403, 'You can only change appointments assigned to you.');
  const status = String(booking.status || '');
  if (CLOSED.includes(status)) return no(409, `A ${status.replace('_', ' ')} booking cannot be changed this way.`);
  const reason = String(body?.reason || '').trim().slice(0, 200);
  if (['confirm_override', 'clear_override'].includes(action) && actor.tier !== 'admin') return no(403, 'Administrator permission is required.');

  const now = new Date().toISOString();
  const target = String(body?.status || '');
  if (action === 'set_status' && !SETTABLE.includes(target)) return no(400, 'That status cannot be set here.');
  if (action === 'lock' && !booking.assigned_time) return no(409, 'Only a booking with a time can be locked.');
  if (action === 'confirm_override' && booking.availability_override !== true) return no(409, 'This booking has no availability override to confirm.');

  const entry = {
    action: `booking_${action}`, who: actor.name,
    summary: action === 'set_status' ? `Booking status set to ${target}` : `Booking ${action.replace(/_/g, ' ')}`,
    note: [reason, action === 'set_status' ? `was ${status}` : ''].filter(Boolean).join(' · '),
    ids: { booking_request_id: booking.id }, related: { type: 'BookingRequest' as const, id: booking.id },
  };
  const logId = await recordAudit(admin, entry);
  if (!logId) return { status: 500, body: AUDIT_REFUSED as any };

  let out: Record<string, unknown> = {};
  if (action === 'complete') {
    await ensureRouteTemplates(admin);
    const done = await finishCompletion(admin, booking, now);
    const stop = await completeStopOnRoute(admin, booking, actor.name, now);
    out = { message_queued: done.message_queued, balance_request: done.balance_request, route_stop_completed: stop };
  } else if (action === 'set_status') {
    if (target === status) out = { unchanged: true };
    else if (target === 'confirmed') {
      const r = await confirmBookingCore(admin, booking.id, { actorName: actor.name || 'Admin', confirmTime: false });
      if (!r.ok) { await finishAudit(admin, logId, { ...entry, outcome: 'failed' }); return no(r.status, r.error); }
    } else await admin.entities.BookingRequest.update(booking.id, { status: target });
  } else if (action === 'lock') {
    await admin.entities.BookingRequest.update(booking.id, { schedule_status: 'locked', locked_at: now, locked_by: actor.name });
  } else if (action === 'unlock') {
    await admin.entities.BookingRequest.update(booking.id, { schedule_status: 'provisional', locked_at: null, locked_by: null });
  } else if (action === 'confirm_override') {
    await admin.entities.BookingRequest.update(booking.id, { override_status: 'confirmed' });
  } else {
    await admin.entities.BookingRequest.update(booking.id, { availability_override: false, override_status: 'none' });
  }
  await finishAudit(admin, logId, entry);
  return { status: 200, body: { saved: true, action, ...out } };
}