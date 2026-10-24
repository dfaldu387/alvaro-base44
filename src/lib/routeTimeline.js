/**
 * Derives a full-day ordered list of timeline blocks from appointments + drive times.
 *
 * Block types: 'appointment' | 'buffer' | 'drive' | 'idle' | 'lunch' | 'break'
 */

export function buildTimeline(stops, drivingTimes) {
  if (!stops.length) return [];

  const blocks = [];

  stops.forEach((stop, idx) => {
    // 1. Appointment block
    blocks.push({
      type: 'appointment',
      id: `appt-${stop.id}`,
      stopId: stop.id,
      stop,
      startDecimal: stop.apptStart,
      endDecimal: stop.apptEnd,
      durationMins: stop.duration || Math.round((stop.apptEnd - stop.apptStart) * 60),
    });

    // The configured buffer only — a booking with no buffer starts its drive leg
    // straight after the service.
    const bufferMins = (stop.defaultBuffer ?? 0) + (stop.extraBuffer ?? 0);
    const bufferEnd = stop.apptEnd + bufferMins / 60;

    // 2. Buffer block
    if (bufferMins > 0) {
      blocks.push({
        type: 'buffer',
        id: `buffer-${stop.id}`,
        stopId: stop.id,
        startDecimal: stop.apptEnd,
        endDecimal: bufferEnd,
        durationMins: bufferMins,
      });
    }

    const nextStop = stops[idx + 1];
    if (!nextStop) return;

    const driveKey = `${stop.id}_${nextStop.id}`;
    const driveInfo = drivingTimes[driveKey];
    const driveMins = driveInfo?.state === 'ok' ? driveInfo.mins : null;
    const driveKm = driveInfo?.state === 'ok' ? driveInfo.km : null;
    const driveState = driveInfo?.state || 'loading';

    const driveStart = bufferEnd;
    const driveEnd = driveMins != null ? driveStart + driveMins / 60 : driveStart + 0.25; // placeholder 15 min

    // 3. Drive block
    blocks.push({
      type: 'drive',
      id: `drive-${stop.id}-${nextStop.id}`,
      stopId: stop.id,
      nextStopId: nextStop.id,
      startDecimal: driveStart,
      endDecimal: driveEnd,
      durationMins: driveMins,
      km: driveKm,
      driveState,
      suburb: getSuburb(nextStop.address),
      isConflict: driveMins != null && driveEnd > nextStop.apptStart,
    });

    // 4. Idle gap between drive end and next appointment
    const idleStart = driveEnd;
    const idleEnd = nextStop.apptStart;
    const idleMins = Math.round((idleEnd - idleStart) * 60);

    if (idleMins >= 15) {
      // Check if it's lunch time (11:30–14:00)
      const midpoint = (idleStart + idleEnd) / 2;
      const isLunchWindow = midpoint >= 11.5 && midpoint <= 14;
      if (isLunchWindow && idleMins >= 20) {
        blocks.push({
          type: 'lunch',
          id: `lunch-${stop.id}`,
          startDecimal: idleStart,
          endDecimal: idleEnd,
          durationMins: idleMins,
        });
      } else {
        blocks.push({
          type: 'idle',
          id: `idle-${stop.id}`,
          startDecimal: idleStart,
          endDecimal: idleEnd,
          durationMins: idleMins,
        });
      }
    }
  });

  return blocks;
}

export function calcBreakdown(blocks, drivingTimes) {
  let cuttingMins = 0;
  let bufferMins = 0;
  let drivingMins = 0;
  let idleMins = 0;
  let breaksMins = 0;

  blocks.forEach(b => {
    if (b.type === 'appointment') cuttingMins += b.durationMins || 0;
    else if (b.type === 'buffer') bufferMins += b.durationMins || 0;
    else if (b.type === 'drive') drivingMins += b.durationMins || 0;
    else if (b.type === 'idle') idleMins += b.durationMins || 0;
    else if (b.type === 'lunch' || b.type === 'break') breaksMins += b.durationMins || 0;
  });

  return { cuttingMins, bufferMins, drivingMins, idleMins, breaksMins };
}

function getSuburb(address) {
  if (!address) return '';
  const parts = address.split(',');
  return parts[parts.length - 1]?.trim() || parts[0]?.trim() || '';
}