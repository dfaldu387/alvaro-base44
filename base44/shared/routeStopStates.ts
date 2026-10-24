/**
 * Route stop execution states. Pure: no reads, no writes. Used by advanceRouteStop
 * to decide whether a requested step is allowed from the stop's current state.
 */
export type StopAction = 'on_the_way' | 'arrive' | 'start' | 'complete' | 'skip';
/**
 * The states a stop can be IN, and so the only ones that can be stored. "Barber preparing" and "Arriving soon" are
 * not here on purpose: no action leads to them. They are worked out for the customer's tracking view only
 * (see customerStopState.ts) and are never written.
 */
export type StopState = 'planned' | 'on_the_way' | 'arrived' | 'in_service' | 'completed' | 'skipped';
/** What the customer's view can show: a stored state, or one of the two derived ones. */
export type CustomerState = StopState | 'preparing' | 'arriving_soon';

export const STOP_ACTIONS: StopAction[] = ['on_the_way', 'arrive', 'start', 'complete', 'skip'];
const ORDER: StopState[] = ['planned', 'on_the_way', 'arrived', 'in_service', 'completed'];
const at = (s: StopState) => ORDER.indexOf(s);

/** What the customer sees for each state. In service still reads "Arrived". */
export const CUSTOMER_LABEL: Partial<Record<CustomerState, string>> = {
  planned: 'Confirmed',
  preparing: 'Barber preparing',
  on_the_way: 'On the way',
  arriving_soon: 'Arriving soon',
  arrived: 'Arrived',
  in_service: 'Arrived',
  completed: 'Completed',
};

export type Transition =
  | { ok: true; state: StopState; already: boolean }
  | { ok: false; status: number; code: string; message: string };

const no = (status: number, code: string, message: string): Transition => ({ ok: false, status, code, message });

export function transition(currentRaw: unknown, action: StopAction, reason?: unknown): Transition {
  const current = (ORDER.includes(currentRaw as StopState) || currentRaw === 'skipped' ? currentRaw : 'planned') as StopState;
  const idx = ORDER.indexOf(current);

  if (action === 'skip') {
    if (current === 'completed') return no(409, 'ALREADY_COMPLETED', 'This stop is already completed, so it cannot be skipped.');
    if (current === 'skipped') return { ok: true, state: 'skipped', already: true };
    if (String(reason || '').trim() === '') return no(400, 'REASON_REQUIRED', 'Say why the stop is being skipped.');
    return { ok: true, state: 'skipped', already: false };
  }
  if (current === 'skipped') return no(409, 'STOP_SKIPPED', 'This stop was skipped. Rebuild the route if it should be run.');

  if (action === 'on_the_way') return idx >= at('on_the_way') ? { ok: true, state: current, already: true } : { ok: true, state: 'on_the_way', already: false };
  if (action === 'arrive') return idx >= at('arrived') ? { ok: true, state: current, already: true } : { ok: true, state: 'arrived', already: false };
  if (action === 'start') {
    if (idx >= at('in_service')) return { ok: true, state: current, already: true };
    if (idx < at('arrived')) return no(409, 'NOT_ARRIVED', 'Mark the stop as Arrived before starting the haircut.');
    return { ok: true, state: 'in_service', already: false };
  }
  // complete
  if (idx === at('completed')) return { ok: true, state: 'completed', already: true };
  if (idx < at('in_service')) return no(409, 'NOT_STARTED', 'Start the haircut before completing it.');
  return { ok: true, state: 'completed', already: false };
}