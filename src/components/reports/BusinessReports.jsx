import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/states/LoadingState';
import ErrorState from '@/components/states/ErrorState';
import DrillDialog from '@/components/reports/DrillDialog';
import MoneySection from '@/components/reports/MoneySection';
import TimeSection from '@/components/reports/TimeSection';
import RouteSection from '@/components/reports/RouteSection';
import ClientsSection from '@/components/reports/ClientsSection';
import { loadReportData } from '@/lib/reports/loadReportData';
import { computeReport } from '@/lib/reports/reportCalc';
import { buildReportCsv, downloadCsv } from '@/lib/reports/reportCsv';

const ymd = (d) => format(d, 'yyyy-MM-dd');

// Money, time, route efficiency and clients for the selected range.
export default function BusinessReports({ from, to }) {
  const fromStr = ymd(from);
  const toStr = ymd(to);
  const [drill, setDrill] = useState(null);
  const q = useQuery({ queryKey: ['business-report', fromStr, toStr], queryFn: () => loadReportData(fromStr, toStr) });
  const report = useMemo(
    () => (q.data ? computeReport({ ...q.data, from: fromStr, to: toStr, today: ymd(new Date()) }) : null),
    [q.data, fromStr, toStr],
  );

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState title="Could not load the business report" onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">{format(from, 'd MMM yyyy')} to {format(to, 'd MMM yyyy')}. Test data is excluded.</p>
        <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => downloadCsv(buildReportCsv(report, fromStr, toStr), `cut-deluxe-report-${fromStr}-to-${toStr}.csv`)}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>
      <MoneySection money={report.money} time={report.time} onDrill={setDrill} />
      <TimeSection time={report.time} onDrill={setDrill} />
      <RouteSection route={report.route} finalisedCount={report.time.finalisedCount} onDrill={setDrill} />
      <ClientsSection clients={report.clients} onDrill={setDrill} />
      <DrillDialog drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}