import React from 'react';
import { Lock, Pencil, Unlock } from 'lucide-react';

/**
 * The items in an appointment's three-dot menu — the same menu component blocked time
 * uses, so the dots behave identically across the Calendar. Cancelling, removing and
 * completing a real booking stay in the appointment panel behind "Edit appointment":
 * those actions carry customer messages and history, and must never sit one stray tap
 * away from a menu.
 */
export function appointmentMenuItems({ appt, onOpen, onSetScheduleStatus }) {
  const items = [
    { label: 'Edit appointment', icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => onOpen?.(appt) },
  ];

  const live = !['completed', 'cancelled', 'no_show'].includes(appt?.status);
  if (live && appt?.requestId && onSetScheduleStatus && appt.schedule_status !== 'confirmed') {
    items.push(appt.schedule_status === 'locked'
      ? {
        label: 'Unlock time',
        icon: <Unlock className="h-3.5 w-3.5" />,
        onSelect: () => onSetScheduleStatus(appt.id, 'provisional'),
      }
      : {
        label: 'Lock time',
        icon: <Lock className="h-3.5 w-3.5" />,
        onSelect: () => onSetScheduleStatus(appt.id, 'locked'),
      });
  }

  return items;
}