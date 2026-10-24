/**
 * Running counts for the payments health panel. One row, updated in place; a busy webhook never
 * fills the table. Best effort: a failure here is logged and never changes how an event is answered.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export type HealthCounter = 'handled_count' | 'duplicates_ignored' | 'ignored_count' | 'unmatched_count';

export async function bumpWebhookHealth(admin: any, counter: HealthCounter | null, eventType: string): Promise<void> {
  try {
    let row = asList(await admin.entities.PaymentWebhookHealth.list('created_date', 1))[0];
    if (!row) row = await admin.entities.PaymentWebhookHealth.create({ handled_count: 0, duplicates_ignored: 0, ignored_count: 0, unmatched_count: 0 });
    await admin.entities.PaymentWebhookHealth.updateMany(
      { id: row.id },
      { $set: { last_event_at: new Date().toISOString(), last_event_type: eventType.slice(0, 60) }, ...(counter ? { $inc: { [counter]: 1 } } : {}) },
    );
  } catch (e) {
    console.error('paymentWebhookHealth failed', (e as Error)?.message);
  }
}