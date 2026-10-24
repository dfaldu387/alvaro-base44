import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ClientWorkflow from '@/pages/ClientWorkflow';
import CampaignsTab from '@/components/reminders/CampaignsTab';
import HistoryTab from '@/components/reminders/HistoryTab';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'pipeline', label: 'Pipeline', hint: 'Move this week’s clients forward' },
  { key: 'campaigns', label: 'Campaigns', hint: 'Reminders and follow-ups' },
  { key: 'history', label: 'History', hint: 'What previous runs did' },
];

/**
 * Reminders — one destination for the regular-client loop: the weekly pipeline,
 * the campaigns that message clients, and the record of every run.
 *
 * The pipeline and the campaign board keep their own controls and data; this page
 * only gives them one place to live and one tab bar to move between them.
 */
export default function Reminders() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some(t => t.key === requested) ? requested : 'pipeline';

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="px-4 sm:px-6 lg:px-8 pt-5 sm:pt-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">Reminders</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Regular clients due a cut, the campaigns that message them, and every run that has gone out.
        </p>

        <div className="mt-4 flex gap-1 border-b border-zinc-200">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setParams(t.key === 'pipeline' ? {} : { tab: t.key }, { replace: true })}
              className={cn(
                'relative -mb-px border-b-2 px-3 sm:px-4 py-2.5 max-sm:min-h-11 text-left transition-colors',
                tab === t.key
                  ? 'border-[#7c3aed] text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800',
              )}
            >
              <span className="block text-sm font-semibold">{t.label}</span>
              <span className="hidden sm:block text-[11px] text-zinc-400 leading-tight">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'pipeline' && <ClientWorkflow />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}