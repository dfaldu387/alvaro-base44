import React from 'react';
import AdminSection from '@/components/admin/ui/AdminSection';
import Figure from '@/components/reports/Figure';
import { fmtMins } from '@/lib/reports/reportCalc';

export default function RouteSection({ route, finalisedCount, onDrill }) {
  const none = finalisedCount === 0;
  const why = 'No day in this range was finalised, so there are no drive legs to measure.';
  const noLog = 'None of the finalised routes in this range has a before and after record, so the saving cannot be worked out.';
  const saved = route.savedDrive == null ? null : route.savedDrive + route.savedIdle;
  return (
    <AdminSection title="Route efficiency" description="From finalised routes and the before and after figures recorded when each was finalised.">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure label="Average drive between stops" value={route.avgLeg == null ? null : `${route.avgLeg} min`}
          reason={none ? why : 'Finalised days have fewer than two stops, so there are no legs between stops.'}
          onClick={() => onDrill({ title: 'Drive legs, longest first', rows: route.legRows, empty: why })} />
        <Figure label="Worst legs" value={route.worstRows.length ? route.worstRows[0].value : null}
          reason={none ? why : 'No drive legs recorded.'} sub={route.worstRows.length ? 'Longest single leg. Click for the top 5.' : undefined}
          onClick={() => onDrill({ title: 'Five longest legs', rows: route.worstRows, empty: why })} />
        <Figure label="Average stops per day" value={route.stopsPerDay == null ? null : route.stopsPerDay}
          reason={why} onClick={() => onDrill({ title: 'Drive legs by stop', rows: route.legRows, empty: why })} />
        <Figure label="Saved by the optimiser" value={saved == null ? null : fmtMins(saved)}
          reason={none ? why : noLog}
          sub={saved == null ? undefined : `${route.savedDrive} min drive + ${route.savedIdle} min idle${route.withoutRecord ? ` · ${route.withoutRecord} day(s) without a record` : ''}`}
          onClick={() => onDrill({ title: 'Optimiser saving by day', note: 'First "before" and latest "after" recorded at finalisation.', rows: route.savingRows, empty: noLog })} />
      </div>
    </AdminSection>
  );
}