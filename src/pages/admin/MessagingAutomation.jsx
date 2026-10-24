import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, MessageSquare, Bot, Activity } from 'lucide-react';
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

const Section = ({ icon: Icon, step, title, description, children }) => (
  <section className="space-y-2.5">
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-zinc-900">{step}. {title}</h2>
        {description && <p className="text-xs text-zinc-500">{description}</p>}
      </div>
    </div>
    {children}
  </section>
);

/**
 * Messaging & Automation — what used to be the Automation page, in three plain areas:
 * how messages are sent, how the AI assistant answers, and whether the automation is
 * healthy. Technical detail stays available, one click away, in Advanced Diagnostics.
 */
export default function MessagingAutomation() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setFailed(false);
    loadOverview().then(setData).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    await loadOverview().then(setData).catch(() => setFailed(true));
    setTick(t => t + 1);
  };

  if (!data && failed) return <div className="p-5"><ErrorState title="Couldn't load messaging and automation status" description="Please try again." onRetry={load} /></div>;
  if (!data) return <div className="p-5 text-sm text-zinc-500">Loading…</div>;

  return (
    <AdminPage
      title="Messaging & Automation"
      subtitle={`Read from the live outbox and run records. Updated ${stamp(data.loadedAt)}.`}
      actions={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh</Button>}
    >
      {failed && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          The last refresh failed. The numbers below are from {stamp(data.loadedAt)} and may be out of date.
        </div>
      )}

      <Section icon={MessageSquare} step={1} title="Messaging controls" description="Who is allowed to receive a message. Switching to live asks for confirmation.">
        <MessagingModePanel settings={data.settings} onChanged={async () => { await loadOverview().then(setData); setTick(t => t + 1); }} />
      </Section>

      <Section icon={Bot} step={2} title="AI assistant" description="How the assistant answers customers. Draft mode always needs your approval before anything is sent.">
        <AssistantModePanel settings={data.settings} onChanged={async () => { await loadOverview().then(setData); }} />
      </Section>

      <Section icon={Activity} step={3} title="Automation health" description="Whether the background engine is running, and what is waiting in the queue.">
        <StaleBanner health={data.health} />
        <JobStaleBanners data={data} />
        <HealthPanel data={data} />
      </Section>

      <details id="diagnostics" className="rounded-xl border border-zinc-200 bg-white">
        <summary className="cursor-pointer p-3 text-sm font-bold text-zinc-900">Advanced Diagnostics</summary>
        <div className="space-y-4 border-t border-zinc-100 p-3">
          <p className="text-xs text-zinc-500">Scheduled jobs, the full message queue, test messages and message wording. Nothing here changes what customers receive unless you use a control on purpose.</p>
          <JobsPanel data={data} />
          <TestMessageControl onCreated={refresh} />
          <TemplatesSection />
          <QueuePanel tick={tick} />
        </div>
      </details>
    </AdminPage>
  );
}