import { applyManualPlacement } from '@/lib/manualPlacement';

/**
 * Auto Sort — applying a sorted day.
 *
 * The browser never writes an appointment time. Each move is submitted to the
 * backend placement command, which re-validates it against the shared Category 1
 * engine (availability, hours, protected time, overlaps, breaks, coverage,
 * travel) before saving.
 *
 * A move can be blocked only because another appointment has not moved out of
 * the way yet, so refused moves are retried while a pass still makes progress.
 * Anything the backend never accepts stays exactly where it was.
 */
export async function applyAutoSortMoves(moves) {
  const applied = [];
  const lastResponse = new Map();
  let pending = [...moves];
  let progress = true;

  while (pending.length > 0 && progress) {
    progress = false;
    const stillPending = [];
    for (const move of pending) {
      const data = await applyManualPlacement({
        requestId: move.requestId,
        startDecimal: move.startDecimal,
        date: move.date,
        barberId: move.barberId || null,
        expectedUpdatedDate: move.expectedUpdatedDate || null,
        note: 'Auto Sort',
      });
      if (data?.saved === true) {
        applied.push({ move, data });
        progress = true;
      } else {
        lastResponse.set(move.id, data);
        stillPending.push(move);
      }
    }
    pending = stillPending;
  }

  return {
    applied,
    refused: pending.map(move => ({ move, data: lastResponse.get(move.id) || null })),
  };
}