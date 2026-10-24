import React from 'react';
import { calendarGapSegments } from '@/lib/calendarGapSegments';
import CalendarGapSegment from '@/components/schedule/CalendarGapSegment';

export default function CalendarGapLayer({ appointments, legs, bounds, hourStart, pxPerHour, insetClass = 'left-0.5 right-0.5' }) {
  return calendarGapSegments(appointments, legs, bounds).map(segment => (
    <CalendarGapSegment key={segment.id} segment={segment} insetClass={insetClass}
      top={(segment.start - hourStart) * pxPerHour}
      height={(segment.end - segment.start) * pxPerHour} />
  ));
}