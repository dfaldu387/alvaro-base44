import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { PAGE, uniqueIds, deleteByIds, isProtectedAppointment, isProtectedBooking } from '../../shared/clientDeletion.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

// Admin-authoritative bulk delete for Clients. Admin only.
//
// Safety rules (identical to the test-data cleanup):
//  • Only records reached through a secure link (client_id, or the appointment
//    ids that belong to those clients) are ever deleted — a client name alone
//    never selects a booking for deletion.
//  • Confirmed/completed bookings and scheduled/completed appointments are
//    operational history: a client holding them is never deleted. Those clients
//    are reported back in `blocked` instead.
//  • Test clients (is_test = true) are exempt — their linked test records
//    cascade, exactly as they do in the test-data cleanup.
//  • Activity is removed before bookings, and bookings before clients, so
//    nothing is left orphaned.

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Only admins can delete clients.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const raw = Array.isArray(body?.clientIds) ? body.clientIds : [];
    const clientIds = uniqueIds(raw.map((id: any) => ({ id })));
    if (clientIds.length === 0) {
      return Response.json({ error: 'No clients selected.' }, { status: 400 });
    }

    const admin = base44.asServiceRole;

    const clients = await admin.entities.ReminderClient.filter({ id: { $in: clientIds } }, '-created_date', PAGE);
    if (clients.length === 0) {
      return Response.json({ success: true, deleted: {}, deletedIds: [], blocked: [] });
    }

    // Client names are only used to detect a denormalised link for the safety
    // guard (never to choose records for deletion).
    const names = [...new Set(clients.map((c: any) => (c.client_name || '').trim()).filter(Boolean))];

    const [bookingsByClient, appointments, messages, workflowItems, recurringSetups, bookingsByName] = await Promise.all([
      admin.entities.BookingRequest.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE),
      admin.entities.Appointment.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE),
      admin.entities.Message.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE),
      admin.entities.WorkflowItem.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE),
      admin.entities.RecurringSetup.filter({ client_id: { $in: clientIds } }, '-created_date', PAGE),
      names.length ? admin.entities.BookingRequest.filter({ client_name: { $in: names } }, '-created_date', PAGE) : [],
    ]);

    // Route Flow legs are real schedule records — a leg is removed when either
    // end is an appointment that goes with the client.
    const appointmentIds = uniqueIds(appointments);
    const legs = appointmentIds.length
      ? (await Promise.all([
          admin.entities.RouteConnection.filter({ from_appointment_id: { $in: appointmentIds } }, '-created_date', PAGE),
          admin.entities.RouteConnection.filter({ to_appointment_id: { $in: appointmentIds } }, '-created_date', PAGE),
        ])).flat()
      : [];

    const sameName = (a: string, b: string) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

    const blocked: any[] = [];
    const deletable: any[] = [];
    const doomedBookingIds = new Set<string>();
    const doomedAppointmentIds = new Set<string>();

    for (const client of clients) {
      const ownedBookings = bookingsByClient.filter((b: any) => b.client_id === client.id);
      const ownedAppointments = appointments.filter((a: any) => a.client_id === client.id);
      const linkedBookings = [...ownedBookings, ...bookingsByName.filter((b: any) => sameName(b.client_name, client.client_name))];

      const isTest = client.is_test === true;
      const hasHistory = linkedBookings.some(isProtectedBooking) || ownedAppointments.some(isProtectedAppointment);

      if (!isTest && hasHistory) {
        blocked.push({ id: client.id, name: client.client_name, reason: 'linked to confirmed or completed bookings' });
        continue;
      }

      deletable.push(client);
      ownedBookings.forEach((b: any) => doomedBookingIds.add(b.id));
      ownedAppointments.forEach((a: any) => doomedAppointmentIds.add(a.id));
    }

    const deletableIds = new Set(deletable.map((c: any) => c.id));
    const messageIds = uniqueIds(messages.filter((m: any) => deletableIds.has(m.client_id)));
    const workflowIds = uniqueIds(workflowItems.filter((w: any) => deletableIds.has(w.client_id)));
    const recurringIds = uniqueIds(recurringSetups.filter((r: any) => deletableIds.has(r.client_id)));
    const deletedIds = deletable.map((c: any) => c.id);

    // Who deleted what is written BEFORE anything is deleted; if it cannot be written, nothing is.
    const auditBase = { action: 'clients_deleted', who: user.full_name || user.email || 'Admin', summary: 'Clients and their linked records were deleted' };
    let logId: string | null = null;
    if (deletedIds.length > 0) {
      logId = await recordAudit(admin, {
        ...auditBase,
        note: 'Planned counts; replaced by the final counts when the deletion finishes.',
        counts: {
          clients: deletedIds.length, bookings: doomedBookingIds.size, appointments: doomedAppointmentIds.size,
          messages: messageIds.length, workflow_items: workflowIds.length, recurring_setups: recurringIds.length,
          route_flow: uniqueIds(legs).length,
        },
      });
      if (!logId) return Response.json(AUDIT_REFUSED, { status: 500 });
    }

    const deleted = {
      messages: await deleteByIds(admin.entities.Message, messageIds),
      workflow_items: await deleteByIds(admin.entities.WorkflowItem, workflowIds),
      recurring_setups: await deleteByIds(admin.entities.RecurringSetup, recurringIds),
      appointments: await deleteByIds(admin.entities.Appointment, [...doomedAppointmentIds]),
      route_flow: await deleteByIds(admin.entities.RouteConnection, uniqueIds(legs)),
      bookings: await deleteByIds(admin.entities.BookingRequest, [...doomedBookingIds]),
      clients: await deleteByIds(admin.entities.ReminderClient, deletedIds),
    };

    await finishAudit(admin, logId, { ...auditBase, counts: deleted });

    return Response.json({
      success: true,
      deleted,
      deletedIds,
      blocked,
      requested: clientIds.length,
    });
  } catch (error: any) {
    // The raw failure stays in the logs; the app only ever shows a safe message.
    console.error('deleteClients failed:', error?.message || error, error?.stack || '');
    return Response.json({ error: 'Deletion failed. Please try again.' }, { status: 500 });
  }
}