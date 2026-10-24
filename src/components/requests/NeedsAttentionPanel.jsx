import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { when } from '@/lib/conversations';

const asList = (r) => (Array.isArray(r) ? r : (r?.items || []));

/**
 * Pinned to the top of Requests: bookings whose customer replied NO / CANCEL /
 * RESCHEDULE, and replies that could not be tied to one booking. Nothing here
 * changes a booking. Marking handled runs an admin-only backend action that is audited.
 */
export default function NeedsAttentionPanel() {
  const [flags, setFlags] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [bookings, setBookings] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [f, u] = await Promise.all([
      base44.entities.BookingReplyFlag.filter({ kind: 'needs_attention', status: 'open' }, { sort: '-created_date', limit: 50 }),
      base44.entities.UnmatchedReply.filter({ status: 'open' }, { sort: '-created_date', limit: 50 }),
    ]);
    const open = asList(f);
    const ids = [...new Set(open.map((x) => x.booking_request_id))];
    const rows = ids.length ? asList(await base44.entities.BookingRequest.filter({ id: { $in: ids } }, { limit: 100 })) : [];
    setBookings(Object.fromEntries(rows.map((b) => [b.id, b])));
    setFlags(open);
    setUnmatched(asList(u));
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const resolve = async (kind, id) => {
    setBusyId(id); setError('');
    try {
      const res = await base44.functions.invoke('resolveReplyFlag', { kind, id });
      if (res?.data?.ok === false) throw new Error(res.data.message);
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e?.response?.data?.message || 'Could not mark this as handled. Only administrators can do this.');
    } finally { setBusyId(null); }
  };

  if (flags.length === 0 && unmatched.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700" />
        <h2 className="text-sm font-bold text-amber-900">Needs attention ({flags.length + unmatched.length})</h2>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {flags.map((f) => {
        const b = bookings[f.booking_request_id];
        return (
          <div key={f.id} className="rounded-lg bg-white border border-zinc-200 p-3 space-y-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 break-words">{b?.client_name || 'Booking'}</p>
              <p className="text-xs text-zinc-500 break-words">
                {[f.service_date, b?.assigned_time, b?.address].filter(Boolean).join(' · ') || 'Booking details unavailable'}
              </p>
              <p className="text-sm text-zinc-800 mt-1 break-words">Replied: "{f.reply_text}"</p>
              <p className="text-[11px] text-zinc-500">Received {when(f.created_date)}. The appointment is unchanged until you act on it.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(f.client_id || b?.client_id) && (
                <Button asChild size="sm" variant="outline" className="min-h-[40px]"><Link to={`/admin/messages?client=${f.client_id || b.client_id}`}>Open conversation</Link></Button>
              )}
              <Button size="sm" variant="outline" className="min-h-[40px]" disabled={busyId === f.id} onClick={() => resolve('flag', f.id)}>
                {busyId === f.id ? 'Saving…' : 'Mark handled'}
              </Button>
            </div>
          </div>
        );
      })}
      {unmatched.map((r) => (
        <div key={r.id} className="rounded-lg bg-white border border-zinc-200 p-3 space-y-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 break-words">Reply from {r.from_phone}</p>
            <p className="text-sm text-zinc-800 break-words">"{r.reply_text}"</p>
            <p className="text-[11px] text-zinc-500">Received {when(r.created_date)} · Not matched to a booking: {r.reason}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {r.client_id && <Button asChild size="sm" variant="outline" className="min-h-[40px]"><Link to={`/admin/messages?client=${r.client_id}`}>Open conversation</Link></Button>}
            <Button size="sm" variant="outline" className="min-h-[40px]" disabled={busyId === r.id} onClick={() => resolve('unmatched', r.id)}>
              {busyId === r.id ? 'Saving…' : 'Mark reviewed'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}