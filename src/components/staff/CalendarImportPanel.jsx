import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

/**
 * CalendarImportPanel — Google busy time as unavailable time, for the person signed in.
 * Shown inside the Google Calendar card once connected. All wording is plain: how fresh
 * the blocks are, whether they may be out of date, and which appointments clash.
 * Nothing here changes a booking: conflicts are warnings only.
 */
const PROBLEMS = {
  not_connected: 'Google is not connected, so it could not be read.',
  google_unreachable: 'Google could not be reached.',
  google_refused: 'Google refused the request. You may need to reconnect.',
  too_many_events: 'There were too many events to read safely.',
  partial: 'Some events could not be read or saved.',
};

const ago = (iso) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : null);

export default function CalendarImportPanel({ info, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!info) return null;

  const call = async (body) => {
    setBusy(true);
    setError('');
    try {
      await base44.functions.invoke('calendarImport', body);
    } catch {
      setError('That did not work. Please try again.');
    }
    await onChanged();
    setBusy(false);
  };

  const synced = ago(info.last_success_at);
  const conflicts = info.conflicts || [];

  return (
    <div className="mt-4 pt-4 border-t border-zinc-200 space-y-3 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">Block my busy Google time</p>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed break-words">
            {info.enabled
              ? `On${info.account ? ` · reading ${info.account}` : ''}. Busy times in your calendar can't be booked. Event names are never saved.`
              : 'Off. Turn on to make busy times in your own Google Calendar unbookable. Event names are never saved.'}
          </p>
        </div>
        <Switch checked={info.enabled} disabled={busy} onCheckedChange={(v) => call({ action: 'set', enabled: v })} aria-label="Block my busy Google time" />
      </div>

      {info.enabled && (
        <>
          <div className="text-xs text-zinc-600 leading-relaxed space-y-1">
            <p>{synced ? `Last synced ${synced}.` : 'Not synced yet.'} {info.blocks_held} Google block{info.blocks_held === 1 ? '' : 's'} held.</p>
            {info.failure_count > 0 && <p className="text-zinc-500">{info.failure_count} sync problem{info.failure_count === 1 ? '' : 's'} so far.</p>}
          </div>

          {info.stale && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 leading-relaxed">
                The last sync didn't finish{PROBLEMS[info.last_error] ? `: ${PROBLEMS[info.last_error]}` : '.'} The blocks shown are the previous ones, kept in place so time you are busy stays unbookable. They may be out of date.
              </p>
            </div>
          )}
          {!info.stale && info.out_of_date && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 leading-relaxed">Google blocks may be out of date. {synced ? `They were last updated ${synced}.` : 'They have not been synced yet.'}</p>
            </div>
          )}
          {info.stale && info.out_of_date && synced && (
            <p className="text-xs text-amber-800">Google blocks may be out of date: the last good sync was {synced}.</p>
          )}

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-900">Treat all-day events as busy</p>
              <p className="text-xs text-zinc-500 leading-relaxed">Off by default, so a birthday doesn't close a whole day.</p>
            </div>
            <Switch checked={info.include_all_day} disabled={busy} onCheckedChange={(v) => call({ action: 'set', include_all_day: v })} aria-label="Treat all-day events as busy" />
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1.5">
              <p className="text-xs font-semibold text-red-900">Your Google Calendar clashes with {conflicts.length === 1 ? 'an appointment' : `${conflicts.length} appointments`}. Nothing has been changed.</p>
              {conflicts.map((c) => (
                <p key={`${c.booking_id}-${c.starts}`} className="text-xs text-red-800 leading-relaxed break-words">
                  {c.client_name}, {c.date}, {c.starts}–{c.ends}
                </p>
              ))}
            </div>
          )}

          <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={() => call({ action: 'sync' })}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync now
          </Button>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}