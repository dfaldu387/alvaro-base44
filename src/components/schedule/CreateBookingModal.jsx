/**
 * CreateBookingModal — the manual booking entry point used by the Calendar.
 * The form itself is CreateAppointmentSheet (Square-style); this keeps the
 * calendar's existing wiring (a close handler and one saved callback) intact.
 */
import React from 'react';
import CreateAppointmentSheet from '@/components/appointments/CreateAppointmentSheet';

export default function CreateBookingModal(props) {
  return <CreateAppointmentSheet {...props} />;
}