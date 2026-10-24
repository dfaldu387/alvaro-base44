import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Quietly refreshes Google busy time when an availability page opens.
 *
 * The server is the real throttle (once per 15 minutes per user, and only when the
 * switch is on). The short guard here only stops three pages opened in a row from
 * sending three requests. Failures are silent: the card shows freshness and problems.
 */
let lastKick = 0;
const SPACING_MS = 60 * 1000;

export default function useCalendarAutoSync(onChanged) {
  const cb = useRef(onChanged);
  cb.current = onChanged;

  useEffect(() => {
    const now = Date.now();
    if (now - lastKick < SPACING_MS) return;
    lastKick = now;
    base44.functions.invoke('calendarImport', { action: 'auto' })
      .then((res) => {
        const d = res?.data;
        if (d?.ran && (d.added || d.updated || d.removed)) cb.current?.();
      })
      .catch(() => {});
  }, []);
}