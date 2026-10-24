import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import ErrorState from '@/components/states/ErrorState';
import AdminPage from '@/components/admin/ui/AdminPage';
import CampaignSettingsForm from '@/components/campaign/CampaignSettingsForm';
import RunHealthBanner from '@/components/reminders/RunHealthBanner';
import SummaryTiles from '@/components/reminders/SummaryTiles';
import ReminderBoard from '@/components/reminders/ReminderBoard';
import SkippedList from '@/components/reminders/SkippedList';
import DryRunPreview from '@/components/reminders/DryRunPreview';
import DryRunControl from '@/components/reminders/DryRunControl';
import CadenceBackfillPanel from '@/components/reminders/CadenceBackfillPanel';
import { ACTION_CONFIRM, ACTION_LABEL } from '@/lib/reminderMeta';

const errText = (e) => e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong.';

export default function Campaign() {
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
      .then(([b, p]) => { setData(b.data); setPreview(p.data); }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Nothing is shown as done until the server confirms it, then the board is re-read.
  const onAction = async (action, card) => {
    if (!window.confirm(ACTION_CONFIRM[action](card.name))) return;
    setBusyId(card.id); setNotice(null);
    try {
      const r = (await base44.functions.invoke('campaignAction', { action, client_id: card.client_id })).data;
      setNotice({ ok: r.ok, text: `${ACTION_LABEL[action]} (${card.name}): ${r.message}${r.audit_recorded === false ? ' The activity log entry could not be saved.' : ''}` });
    } catch (e) {
      setNotice({ ok: false, text: `${ACTION_LABEL[action]} (${card.name}) was not done: ${errText(e)}` });
    }
    setBusyId(null); load();
  };

  // Admin-run previews are always dry runs on the server (they cannot send).
  const runPreview = async (stage) => {
    setRunning(stage); setNotice(null);
    try {
      const r = (await base44.functions.invoke('campaignRun', { stage })).data;
      setNotice({ ok: !!r.ran, text: r.ran ? `Preview recorded (${r.mode === 'dry_run' ? 'Dry run — nothing sent' : r.mode}).` : r.reason || r.error || 'Nothing was run.' });
    } catch (e) { setNotice({ ok: false, text: errText(e) }); }
    setRunning(''); load();
  };

  if (error) return <div className="p-6"><ErrorState title="Couldn't load the reminders board" description="Please try again." onRetry={load} /></div>;
  if (!data || !preview) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  return (
    <AdminPage
      title="Reminders"
      subtitle={`Week ${data.week}. Regular clients who are due, who have been messaged, and what happened next. Every card is built from the campaign's stored records.`}
    >

      <RunHealthBanner health={data.health} />
      {notice && <div className={`rounded-lg border p-3 text-sm ${notice.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{notice.text}</div>}

      <DryRunPreview preview={preview} running={running} onRun={runPreview} />
      <DryRunControl preview={preview} onChanged={load} />

      <CadenceBackfillPanel onApplied={load} />

      <SummaryTiles data={data} filter={filter} onPick={setFilter} />
      {filter && <p className="text-xs text-zinc-600">Showing only the clients behind this number. <button className="font-semibold text-indigo-600" onClick={() => setFilter(null)}>Show all</button></p>}

      <ReminderBoard cards={data.settings?.dry_run === false ? data.cards : data.cards.map((c) => ({ ...c, can_send_now: false, send_blocked: 'Dry-run mode is ON, so Send now is disabled.' }))} filter={filter} busyId={busyId} onAction={onAction} />
      <SkippedList skipped={data.skipped} open={filter === 'skipped'} />

      <details className="rounded-xl border border-zinc-200 bg-white">
        <summary className="cursor-pointer p-3 text-sm font-bold text-zinc-900">Campaign settings</summary>
        <div className="space-y-3 p-3">
          <p className="text-xs text-zinc-500">{data.live_sending ? 'Live sending is ON.' : `Live sending is OFF. ${data.live_blocked_reason}`}</p>
          <CampaignSettingsForm settings={data.settings} onSaved={load} />
        </div>
      </details>
    </AdminPage>
  );
}