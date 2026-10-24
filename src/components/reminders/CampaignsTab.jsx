import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Eye, Send } from 'lucide-react';
import ErrorState from '@/components/states/ErrorState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import CampaignSettingsForm from '@/components/campaign/CampaignSettingsForm';
import RunHealthBanner from '@/components/reminders/RunHealthBanner';
import SummaryTiles from '@/components/reminders/SummaryTiles';
import ReminderBoard from '@/components/reminders/ReminderBoard';
import SkippedList from '@/components/reminders/SkippedList';
import StagePreview from '@/components/reminders/StagePreview';
import DryRunControl from '@/components/reminders/DryRunControl';
import CadenceBackfillPanel from '@/components/reminders/CadenceBackfillPanel';
import { ACTION_CONFIRM, ACTION_LABEL } from '@/lib/reminderMeta';

const errText = (e) => e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong.';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The next time this weekday's run would fire, in the viewer's own time. */
function nextRunOn(dayName, hour) {
  const target = WEEKDAYS.indexOf(dayName);
  if (target < 0) return null;
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() + ((target - now.getDay() + 7) % 7));
  d.setHours(Number.isFinite(Number(hour)) ? Number(hour) : 10, 0, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 7);
  return d;
}
const runLabel = (d, hour) => (d
  ? `${d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} · ${String(Number(hour) || 10).padStart(2, '0')}:00`
  : null);

const StageCard = ({ title, day, hour, stageKey, stage, running, onRun }) => {
  const run = stage.run;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900">{title}</p>
          <p className="text-xs text-zinc-500">Every {day} from {String(Number(hour) || 10).padStart(2, '0')}:00</p>
        </div>
        <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Preview only
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Eligible</p>
          <p className="font-bold text-zinc-900">{run ? run.eligible_total : 'No preview yet'}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Would be sent</p>
          <p className="font-bold text-zinc-900">{run ? stage.would_send.length : '—'}</p>
        </div>
      </div>

      {stage.template.body && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Message</p>
          <p className="mt-1 line-clamp-3 text-xs leading-snug text-zinc-700">{stage.template.body}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="bg-white text-zinc-800" disabled={!!running} onClick={() => onRun(stageKey)}>
          <Eye className="w-3.5 h-3.5 mr-1.5" />
          {running === stageKey ? 'Running…' : 'Run preview'}
        </Button>
        <span className="text-[11px] text-zinc-400">
          {run ? `Last run ${run.finished_at ? new Date(run.finished_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : 'today'}` : 'Nothing recorded this week'}
        </span>
      </div>
    </div>
  );
};

/**
 * Campaigns — the reminder and follow-up campaigns, in plain English.
 *
 * One status line replaces the repeated dry-run warnings: the mode is said once,
 * at the top, and every action below says whether it sends anything. A preview run
 * never contacts a client.
 */
export default function CampaignsTab() {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [running, setRunning] = useState('');

  const load = useCallback(() => {
    setError(false);
    return Promise.all([base44.functions.invoke('campaignBoard', {}), base44.functions.invoke('campaignPreview', {})])
      .then(([b, p]) => { setData(b.data); setPreview(p.data); })
      .catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Nothing is shown as done until the server confirms it, then the board is re-read.
  const onAction = async (action, card) => {
    if (!window.confirm(ACTION_CONFIRM[action](card.name))) return;
    setBusyId(card.id); setNotice(null);
    try {
      const r = (await base44.functions.invoke('campaignAction', { action, client_id: card.client_id })).data;
      setNotice({ ok: r.ok, text: `${ACTION_LABEL[action]} (${card.name}): ${r.message}` });
    } catch (e) {
      setNotice({ ok: false, text: `${ACTION_LABEL[action]} (${card.name}) was not done: ${errText(e)}` });
    }
    setBusyId(null); load();
  };

  // A preview run records what would happen and queues nothing.
  const runPreview = async (stage) => {
    setRunning(stage); setNotice(null);
    try {
      const r = (await base44.functions.invoke('campaignRun', { stage })).data;
      setNotice({
        ok: !!r.ran,
        text: r.ran
          ? `Preview recorded — nothing was sent (${r.mode === 'dry_run' ? 'preview only' : r.mode}).`
          : r.reason || r.error || 'Nothing was run.',
      });
    } catch (e) { setNotice({ ok: false, text: errText(e) }); }
    setRunning(''); load();
  };

  if (error) return <div className="p-4 sm:p-6"><ErrorState title="Couldn't load the campaigns" description="Please try again." onRetry={load} /></div>;
  if (!data || !preview) return <div className="p-4 sm:p-6 text-sm text-zinc-500">Loading…</div>;

  const previewOnly = data.settings ? data.settings.dry_run !== false : true;
  const sc = preview.schedule;
  const boards = data.settings?.dry_run === false ? data.cards : data.cards.map((c) => ({ ...c, can_send_now: false, send_blocked: 'Preview mode is on, so Send now is disabled.' }));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-5">
      {/* The state of the campaign, said once. */}
      <section className={cn('rounded-xl border-2 p-4', previewOnly ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={cn('text-[11px] font-bold uppercase tracking-wider', previewOnly ? 'text-amber-700' : 'text-emerald-700')}>Campaign status</p>
            <p className={cn('text-2xl font-extrabold', previewOnly ? 'text-amber-900' : 'text-emerald-900')}>
              {previewOnly ? 'Preview Mode Active' : 'Live campaign'}
            </p>
            <p className={cn('text-sm mt-1', previewOnly ? 'text-amber-800' : 'text-emerald-800')}>
              {previewOnly
                ? 'No messages will be sent. You can safely preview the campaign.'
                : 'Scheduled runs may send to eligible clients once the wording is approved.'}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Reminders go out every {sc.outreach_day}, follow-ups every {sc.followup_day}, from {String(Number(sc.run_hour)).padStart(2, '0')}:00 ({sc.timezone}).
            </p>
          </div>
          <div className="rounded-lg border border-black/5 bg-white/70 px-3 py-2 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Next reminder run</p>
            <p className="text-sm font-bold text-zinc-900">{runLabel(nextRunOn(sc.outreach_day, sc.run_hour), sc.run_hour) || 'Not scheduled'}</p>
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Next follow-up run</p>
            <p className="text-sm font-bold text-zinc-900">{runLabel(nextRunOn(sc.followup_day, sc.run_hour), sc.run_hour) || 'Not scheduled'}</p>
          </div>
        </div>
      </section>

      {notice && (
        <div className={cn('rounded-lg border p-3 text-sm', notice.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800')}>
          {notice.text}
        </div>
      )}

      {/* The two campaigns, each with its own preview action. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <StageCard title="Weekly reminder campaign" day={sc.outreach_day} hour={sc.run_hour} stageKey="outreach" stage={preview.stages.outreach} running={running} onRun={runPreview} />
        <StageCard title="Follow-up campaign" day={sc.followup_day} hour={sc.run_hour} stageKey="followup" stage={preview.stages.followup} running={running} onRun={runPreview} />
      </div>

      <p className="text-[11px] text-zinc-500">
        A preview records what would happen to this week’s clients and sends nothing. {preview.cap_rule}
      </p>

      {/* This week's clients, and what really happened to each message. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900">This week’s clients</h2>
          <p className="text-xs text-zinc-500">Week {data.week}. Queued, sent and delivered stay three different things.</p>
        </div>
        <RunHealthBanner health={data.health} />
        <SummaryTiles data={data} filter={filter} onPick={setFilter} />
        {filter && (
          <p className="text-xs text-zinc-600">
            Showing only the clients behind this number.{' '}
            <button className="font-semibold text-indigo-600" onClick={() => setFilter(null)}>Show all</button>
          </p>
        )}
        <ReminderBoard cards={boards} filter={filter} busyId={busyId} onAction={onAction} />
        <SkippedList skipped={data.skipped} open={filter === 'skipped'} />
      </section>

      <details className="rounded-xl border border-zinc-200 bg-white">
        <summary className="cursor-pointer p-3 text-sm font-bold text-zinc-900">Preview this week’s run in full</summary>
        <div className="space-y-3 p-3">
          <StagePreview title="Reminders" s={preview.stages.outreach} />
          <StagePreview title="Follow-ups" s={preview.stages.followup} />
        </div>
      </details>

      <details className="rounded-xl border border-zinc-200 bg-white">
        <summary className="cursor-pointer p-3 text-sm font-bold text-zinc-900">Campaign settings and sending</summary>
        <div className="space-y-3 p-3">
          <CampaignSettingsForm settings={data.settings} onSaved={load} />
          <DryRunControl preview={preview} onChanged={load} />
          <CadenceBackfillPanel onApplied={load} />
        </div>
      </details>

      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Send className="w-3 h-3" /> Delivery status for each client is on their card above. Previous runs are on the History tab.
      </p>
    </div>
  );
}