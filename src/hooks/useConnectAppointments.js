import { useCallback } from 'react';
import { finishDayRoute, fmtRouteMins } from '@/lib/dayRouteStatus';

/** One click saves planning times, then reads the saved calendar and drive legs. */
export default function useConnectAppointments({ date, staffId, busy, confirming, saving, setBusy, reload, refreshRoute, notify }) {
  return useCallback(async () => {
    if (busy || confirming || saving) return;
    setBusy(true);
    try {
      const result = await finishDayRoute({ date, teamMemberId: staffId });
      const [refreshed] = await Promise.all([reload({ silent: true }), refreshRoute()]);
      if (!result?.ok) {
        notify({ message: 'Could not connect the whole day', description: [result?.message, ...(result?.failed || []).flatMap(f => f.warnings || [])].filter(Boolean).join(' '), type: 'error' });
      } else if (!refreshed) {
        notify({ message: 'Route saved; calendar could not refresh', description: 'Click Connect Appointments again to reload the saved times. Do not confirm until the calendar is up to date.', type: 'error' });
      } else {
        const review = (result.drive_legs_unavailable || 0) + (result.drive_legs_conflict || 0);
        const calendarNote = !result.calendar ? '' : result.calendar.connected ? ' · added to your Google Calendar' : ' · Google Calendar not connected';
        notify({
          message: 'Route connected',
          description: `${result.moved || 0} times updated · ${result.drive_legs_created || 0} drive legs · ${fmtRouteMins(result.drive_minutes)} driving · ${fmtRouteMins(result.idle_minutes)} idle. Remaining gaps show why.${review ? ` ${review} segments need review.` : ''}${calendarNote}`,
          type: 'success',
        });
      }
    } finally {
      setBusy(false);
    }
  }, [date, staffId, busy, confirming, saving, setBusy, reload, refreshRoute, notify]);
}