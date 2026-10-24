import React from 'react';
import { cn } from '@/lib/utils';
import { jobView } from '@/lib/automation';
import JobCard from '@/components/automation/JobCard';

const JOBS = [
  {
    key: 'sweep', name: 'Message outbox sweep', sentLabel: 'Sent',
    schedule: () => 'Every 5 minutes.',
  },
  {
    key: 'arrival', name: 'Night-before arrival times', sentLabel: 'Queued',
    schedule: (s) => `Hourly, on the hour. Queues tomorrow's messages from ${s?.arrival_send_hour ?? 18}:00 Sydney time; earlier runs record that they did nothing.`,
  },
  {
    key: 'campaign', name: 'Regular-client reminder campaign', sentLabel: 'Queued',
    schedule: (s) => `Hourly, on the hour. Acts on ${s?.campaign_outreach_day || 'Tuesday'} (reminders) and ${s?.campaign_followup_day || 'Thursday'} (follow-ups) from ${s?.campaign_run_hour ?? 10}:00 ${s?.campaign_timezone || 'Australia/Sydney'}; other runs record that they did nothing.`,
  },
];

export default function JobsPanel({ data }) {
  const s = data.settings;
  const dry = s ? s.campaign_dry_run !== false : true;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Scheduled jobs</h2>
      <div className={cn('rounded-lg border p-3 text-sm font-bold', dry ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-300 bg-red-50 text-red-800')}>
        Reminder dry-run mode: {dry ? 'ON' : 'OFF'}
        <p className="text-xs font-normal mt-0.5">{s ? 'From the saved campaign setting.' : 'No saved setting exists, so it defaults to ON.'}{dry ? ' Runs record a preview and queue nothing.' : ' Live sending is allowed once both messages are approved.'}</p>
      </div>
      <ul className="space-y-2">
        {JOBS.map((j) => <JobCard key={j.key} job={j} schedule={j.schedule(s)} view={jobView(j.key, data)} />)}
      </ul>
    </section>
  );
}