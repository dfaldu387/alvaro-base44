import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { PAGE, uniqueIds, deleteByIds } from '../../shared/clientDeletion.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

// Bulk cleanup of test data. Admin only.
//
// Safety rules:
//  • Only records flagged is_test = true are deleted directly.
//  • Related records (appointments, messages, workflow items, recurring setups)
//    are only ever found through a secure relationship to a flagged test record —
//    a client name alone is never used as the basis for deletion.
//  • Call with no payload for a dry run that returns the affected counts;
//    call with { confirm: true } to actually delete.

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const confirmed = body?.confirm === true;

    const admin = base44.asServiceRole;

    const [testClients, testBookings, testLegs] = await Promise.all([
      admin.entities.ReminderClient.filter({ is_test: true }, '-created_date', PAGE),
      admin.entities.BookingRequest.filter({ is_test: true }, '-created_date', PAGE),
      admin.entities.RouteConnection.filter({ is_test: true }, '-created_date', PAGE),
    ]);

    const clientIds = uniqueIds(testClients);
    const bookingIds = uniqueIds(testBookings);

    const [apptByBooking, apptByClient, msgByClient, msgByBooking, wfByBooking, wfByClient, recurring] = await Promise.all([
      bookingIds.length ? admin.entities.Appointment.filter({ booking_request_id: { $in: bookingIds } }, '-created_date', PAGE) : [],
      clientIds.length ? admin.entities.Appointment.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE) : [],
      clientIds.length ? admin.entities.Message.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE) : [],
      bookingIds.length ? admin.entities.Message.filter({ booking_request_id: { $in: bookingIds } }, '-created_date', PAGE) : [],
      bookingIds.length ? admin.entities.WorkflowItem.filter({ booking_request_id: { $in: bookingIds } }, '-created_date', PAGE) : [],
      clientIds.length ? admin.entities.WorkflowItem.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE) : [],
      clientIds.length ? admin.entities.RecurringSetup.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE) : [],
    ]);

    const appointmentIds = uniqueIds([...apptByBooking, ...apptByClient]);
    const messageIds = uniqueIds([...msgByClient, ...msgByBooking]);
    const workflowIds = uniqueIds([...wfByBooking, ...wfByClient]);
    const recurringIds = uniqueIds(recurring);
    const legIds = uniqueIds(testLegs);

    const counts = {
      clients: clientIds.length,
      bookings: bookingIds.length,
      appointments: appointmentIds.length,
      messages: messageIds.length,
      route_flow: legIds.length,
      workflow_items: workflowIds.length,
      recurring_setups: recurringIds.length,
    };

    if (!confirmed) {
      return Response.json({ success: true, dryRun: true, counts });
    }

    // Who deleted what is written BEFORE anything is deleted; if it cannot be written, nothing is.
    const auditBase = { action: 'test_data_deleted', who: user.full_name || user.email || 'Admin', summary: 'Test data was deleted' };
    let logId: string | null = null;
    if (Object.values(counts).some((n) => n > 0)) {
      logId = await recordAudit(admin, { ...auditBase, note: 'Planned counts; replaced by the final counts when the deletion finishes.', counts });
      if (!logId) return Response.json(AUDIT_REFUSED, { status: 500 });
    }

    // Activity first, then bookings, then clients — nothing is left orphaned.
    const deleted = {
      messages: await deleteByIds(admin.entities.Message, messageIds),
      appointments: await deleteByIds(admin.entities.Appointment, appointmentIds),
      workflow_items: await deleteByIds(admin.entities.WorkflowItem, workflowIds),
      recurring_setups: await deleteByIds(admin.entities.RecurringSetup, recurringIds),
      route_flow: await deleteByIds(admin.entities.RouteConnection, legIds),
      bookings: await deleteByIds(admin.entities.BookingRequest, bookingIds),
      clients: await deleteByIds(admin.entities.ReminderClient, clientIds),
    };

    await finishAudit(admin, logId, { ...auditBase, counts: deleted });

    return Response.json({ success: true, counts, deleted });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}