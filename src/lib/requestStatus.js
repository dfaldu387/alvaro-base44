/**
 * The one place that answers "what is happening with this booking request?"
 *
 * A request is always in exactly one state:
 *   scheduled    — it has a calendar slot (provisional / locked / confirmed)
 *   processing   — just saved, Route Flow has not finished with it yet
 *   unscheduled  — Route Flow finished and no valid slot fitted
 *   needs_review — placement could not be decided automatically (missing data,
 *                  coverage, travel that cannot be verified, or Route Flow never
 *                  got to it) — an admin has to look
 *   resolved     — cancelled, declined, completed or a no-show
 *
 * Nothing a request can be in is invisible: every state is shown, and every
 * request that still needs a decision is collected by Needs Action.
 *
 * The stored fields, and who owns them:
 *   status           — the request's business outcome (pending → confirmed /
 *                      declined / cancelled / completed / no_show)
 *   schedule_status  — calendar placement (unscheduled / provisional / locked /
 *                      confirmed)
 *   placement_status — the placement outcome Route Flow recorded (processing /
 *                      placed / unscheduled / needs_review) with
 *                      placement_reason as its short label
 */

export const RESOLVED_BOOKING_STATUSES = ['cancelled', 'declined', 'completed', 'no_show', 'could_not_fit'];
export const PLACED_SCHEDULE_STATUSES = ['provisional', 'locked', 'confirmed'];

/** A request is treated as Processing for this long after it was saved. */
export const PROCESSING_GRACE_MINUTES = 15;

export const REQUEST_STATE = {
  scheduled: 'scheduled',
  processing: 'processing',
  unscheduled: 'unscheduled',
  needs_review: 'needs_review',
  resolved: 'resolved',
};

/** States an admin still has to act on — the Route Flow safety net. */
export const NEEDS_ACTION_STATES = [REQUEST_STATE.processing, REQUEST_STATE.unscheduled, REQUEST_STATE.needs_review];

// `tone` is a StatusBadge tone, so a state means the same colour on every screen.
export const STATE_META = {
  scheduled: { label: 'Scheduled', tone: 'success' },
  processing: { label: 'Processing', tone: 'warning' },
  unscheduled: { label: 'Unscheduled', tone: 'warning' },
  needs_review: { label: 'Needs Review', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'neutral' },
};

const RESOLVED_TONES = { completed: 'success', declined: 'danger', no_show: 'danger' };

const RESOLVED_STATUS_LABELS = {
  cancelled: 'Cancelled',
  declined: 'Declined',
  completed: 'Completed',
  no_show: 'No-show',
  could_not_fit: 'Could not fit',
};

/** Fallback labels for records saved before placement_status was recorded. */
const FALLBACK_REASONS = {
  processing: 'Route Flow has not placed this yet',
  unscheduled: 'No valid slot found inside availability',
  needs_review: 'Not yet placed — needs manual scheduling',
};

/** Which single state a request is in. */
export function requestState(req, now = Date.now()) {
  if (!req) return REQUEST_STATE.resolved;
  if (RESOLVED_BOOKING_STATUSES.includes(req.status)) return REQUEST_STATE.resolved;
  if (PLACED_SCHEDULE_STATUSES.includes(req.schedule_status)) return REQUEST_STATE.scheduled;
  if (req.placement_status === 'placed') return REQUEST_STATE.scheduled;
  if (req.placement_status === 'unscheduled') return REQUEST_STATE.unscheduled;
  if (req.placement_status === 'needs_review') return REQUEST_STATE.needs_review;
  // No placement outcome recorded (an older record): a request saved moments ago
  // is still being worked on; anything older was never placed and needs a human.
  const savedAt = req.created_date ? new Date(req.created_date).getTime() : 0;
  const fresh = savedAt > 0 && (now - savedAt) < PROCESSING_GRACE_MINUTES * 60 * 1000;
  return fresh ? REQUEST_STATE.processing : REQUEST_STATE.needs_review;
}

/** True when the request still needs an admin decision. */
export function isNeedsAction(req, now = Date.now()) {
  return NEEDS_ACTION_STATES.includes(requestState(req, now));
}

export function stateLabel(req) {
  const state = requestState(req);
  if (state === REQUEST_STATE.resolved) return RESOLVED_STATUS_LABELS[req.status] || 'Resolved';
  return STATE_META[state].label;
}

/** The StatusBadge tone for a request's state. */
export function stateTone(req) {
  const state = requestState(req);
  if (state === REQUEST_STATE.resolved) return RESOLVED_TONES[req.status] || 'neutral';
  return STATE_META[state].tone;
}

/** True while Booking Protection is holding this request off the schedule. */
export function isHeld(req) {
  return req?.protection_hold === true;
}

/** Every plain-language reason the request is held, as one line. */
export function heldReason(req) {
  const reasons = Array.isArray(req?.protection_reasons) ? req.protection_reasons.filter(Boolean) : [];
  return reasons.join(' · ');
}

/** The short reason shown under an unresolved request. */
export function stateReason(req) {
  const state = requestState(req);
  if (state === REQUEST_STATE.scheduled || state === REQUEST_STATE.resolved) return '';
  // A hold outranks everything else: nothing can be placed until it is approved.
  if (isHeld(req)) return heldReason(req) || req.placement_reason || FALLBACK_REASONS.needs_review;
  return req.placement_reason || FALLBACK_REASONS[state] || '';
}

/** Filters offered on the Bookings page. */
export const REQUEST_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'needs_action', label: 'Needs Action' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'unscheduled', label: 'Unscheduled' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'completed', label: 'Completed' },
];

export function matchesFilter(req, filterId) {
  const state = requestState(req);
  switch (filterId) {
    case 'needs_action': return NEEDS_ACTION_STATES.includes(state);
    case 'scheduled': return state === REQUEST_STATE.scheduled;
    case 'unscheduled': return state === REQUEST_STATE.unscheduled;
    case 'needs_review': return state === REQUEST_STATE.needs_review;
    case 'cancelled': return req.status === 'cancelled' || req.status === 'declined';
    case 'completed': return req.status === 'completed' || req.status === 'no_show';
    default: return true;
  }
}