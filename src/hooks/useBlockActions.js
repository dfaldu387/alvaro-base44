import { useCallback, useState } from 'react';
import { decimalToLabel } from '@/lib/timeUtils';
import { updateBlockTime } from '@/lib/blockTime';

/**
 * Everything a blocked-time block can do: open its edit dialog, open its delete
 * dialog, close either, follow up on what the dialog saved, and commit a drag or
 * resize. Extracted from the Calendar page so the grids stay presentation only and
 * the block's one workflow lives in one place.
 *
 * The dialogs speak to the server themselves; this only holds what is open and
 * reports the outcome, so a refusal is always said out loud and a success is always
 * shown on the calendar.
 */
export default function useBlockActions({ loadSchedule, refreshDayRoute, addToast }) {
  const [blockEdit, setBlockEdit] = useState(null);
  const [blockDelete, setBlockDelete] = useState(null);

  const openEdit = useCallback((appt) => { setBlockEdit(appt); setBlockDelete(null); }, []);
  const openDelete = useCallback((appt) => { setBlockDelete(appt); setBlockEdit(null); }, []);
  const closeDialogs = useCallback(() => { setBlockEdit(null); setBlockDelete(null); }, []);

  const changed = useCallback((res) => {
    setBlockEdit(null);
    setBlockDelete(null);
    loadSchedule({ silent: true });
    refreshDayRoute();
    const removed = Number(res?.removed) || 0;
    const updated = Number(res?.updated) || 0;
    if (removed > 0) {
      addToast({
        message: removed > 1 ? `${removed} blocks removed` : 'Block removed',
        description: 'That time is available again.',
        type: 'success',
      });
    } else if (updated > 0) {
      addToast({ message: updated > 1 ? `${updated} blocks updated` : 'Block updated', type: 'success' });
    }
  }, [loadSchedule, refreshDayRoute, addToast]);

  const commit = useCallback(async (appt, start, end) => {
    if (!appt?.requestId) return;
    const res = await updateBlockTime({ booking_request_id: appt.requestId, start, end });
    if (res?.saved !== true) {
      addToast({
        message: 'Could not move that block',
        description: res?.error || 'Please try again.',
        type: 'error',
      });
      return;
    }
    addToast({ message: `Block moved to ${decimalToLabel(start)}–${decimalToLabel(end)}`, type: 'success' });
    loadSchedule({ silent: true });
    refreshDayRoute();
  }, [addToast, loadSchedule, refreshDayRoute]);

  return { blockEdit, blockDelete, openEdit, openDelete, closeDialogs, changed, commit };
}