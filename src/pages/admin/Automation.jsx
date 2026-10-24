import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import ErrorState from '@/components/states/ErrorState';
import AdminPage from '@/components/admin/ui/AdminPage';
import { Button } from '@/components/ui/button';
import HealthPanel, { StaleBanner } from '@/components/automation/HealthPanel';
import JobsPanel from '@/components/automation/JobsPanel';
import JobStaleBanners from '@/components/automation/JobStaleBanners';
import MessagingModePanel from '@/components/automation/MessagingModePanel';
import AssistantModePanel from '@/components/assistant/AssistantModePanel';
import QueuePanel from '@/components/automation/QueuePanel';
import TemplatesSection from '@/components/automation/TemplatesSection';
import TestMessageControl from '@/components/automation/TestMessageControl';
import { loadOverview, stamp } from '@/lib/automation';

export default function Automation() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setFailed(false);
    loadOverview().then(setData).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); setTick((t) => t + 1); };

  if (!data && failed) return <div className="p-6"><ErrorState title="Couldn't load automation status" description="Please try again." onRetry={load} /></div>;
  if (!data) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  return (
    <AdminPage
      title="Automation"
      subtitle={`Read from the live outbox and run records. Updated ${stamp(data.loadedAt)}.`}
      actions={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh</Button>}
    >
      <MessagingModePanel settings={data.settings} onChanged={async () => { await loadOverview().then(setData); setTick((t) => t + 1); }} />
      <AssistantModePanel settings={data.settings} onChanged={async () => { await loadOverview().then(setData); }} />
      {failed && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">The last refresh failed. The numbers below are from {stamp(data.loadedAt)} and may be out of date.</div>}
      <StaleBanner health={data.health} />
      <JobStaleBanners data={data} />
      <HealthPanel data={data} />
      <JobsPanel data={data} />
      <TestMessageControl onCreated={refresh} />
      <TemplatesSection />
      <QueuePanel tick={tick} />
    </AdminPage>
  );
}