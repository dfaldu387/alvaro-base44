import React from 'react';
import SectionCard from './SectionCard';
import PriorityDaysEditor from './PriorityDaysEditor';

// Replaces ZoneScheduleSection — priority days only, no times or capacity.
export default function PriorityDaysSection({ draft, set, canEdit }) {
  return (
    <SectionCard title="Priority days" description="These days determine when this area is prioritised. They do not control your bookable hours.">
      <PriorityDaysEditor
        days={draft.service_days || []}
        onChange={(d) => canEdit && set('service_days', d)}
      />
    </SectionCard>
  );
}