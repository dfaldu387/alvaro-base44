/**
 * Provider delivery-status rules shared by the status webhook and the sweep, so a
 * callback that arrives before the Message exists is kept (on the outbox row) and
 * applied afterwards. delivered is final; failed never replaces delivered.
 */
export type DeliveryTarget = 'delivered' | 'failed';

/** queued / sending / sent carry no change: the Message is already "sent". */
export function targetFromProvider(status: unknown): DeliveryTarget | null {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (s === 'delivered') return 'delivered';
  if (s === 'failed' || s === 'undelivered') return 'failed';
  return null;
}

/** The conditional Message update for a recorded target, or null when nothing was recorded. */
export function deliveryUpdate(target: unknown, errorCode?: unknown): { from: string[]; set: Record<string, any> } | null {
  if (target === 'delivered') return { from: ['draft', 'queued', 'sent', 'failed'], set: { delivery_status: 'delivered' } };
  if (target === 'failed') return { from: ['draft', 'queued', 'sent'], set: { delivery_status: 'failed', delivery_error: String(errorCode || 'unknown') } };
  return null;
}

/** What to keep on the outbox row when a second callback arrives: delivered always wins. */
export function mergeRecorded(current: unknown, incoming: DeliveryTarget): DeliveryTarget {
  return current === 'delivered' || incoming === 'delivered' ? 'delivered' : 'failed';
}