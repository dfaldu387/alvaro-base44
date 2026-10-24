import StatusBadge from '@/components/admin/ui/StatusBadge';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { asList, when, STATUS_META } from '@/lib/conversations';

const Row = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 border-b border-zinc-50 last:border-0">
    <span className="text-xs text-zinc-500 shrink-0">{label}</span>
    <span className="text-xs text-zinc-900 text-right min-w-0 break-words">{children}</span>
  </div>
);

const Unavailable = ({ why }) => <span className="text-zinc-400">Unavailable — {why}</span>;

/** Messaging state for one client, read straight from their stored records. */
export default function ClientMessagingSummary({ client }) {
  const [data, setData] = useState({ loading: true, error: false, out: null, inc: null });

  useEffect(() => {
    let live = true;
    setData({ loading: true, error: false, out: null, inc: null });
    Promise.all([
      base44.entities.Message.filter({ client_id: client.id, direction: 'outgoing' }, { sort: '-created_date', limit: 1 }),
      base44.entities.Message.filter({ client_id: client.id, direction: 'incoming' }, { sort: '-created_date', limit: 1 }),
    ]).then(([o, i]) => { if (live) setData({ loading: false, error: false, out: asList(o)[0] || null, inc: asList(i)[0] || null }); })
      .catch(() => { if (live) setData({ loading: false, error: true, out: null, inc: null }); });
    return () => { live = false; };
  }, [client.id]);

  const { loading, error, out, inc } = data;
  const status = out ? (STATUS_META[out.delivery_status || 'sent'] || STATUS_META.sent) : null;
  const noShows = client.no_show_count || 0;

  return (
    <div>
      <Row label="Messaging">
        {client.messaging_opted_out
          ? <span className="font-semibold text-red-600">Opted out{client.opted_out_at ? ` (${when(client.opted_out_at)})` : ''}{client.opt_out_source ? ` · ${client.opt_out_source.replace(/_/g, ' ')}` : ''}</span>
          : <span>Not opted out</span>}
      </Row>
      <Row label="Last message sent">
        {loading ? '…' : error ? <Unavailable why="could not load" /> : out ? (
          <span>{when(out.sent_date || out.created_date)} <StatusBadge status={out.delivery_status || 'sent'}>{status.label}</StatusBadge>
            {out.simulated && <span className="block text-[11px] font-semibold text-violet-700">Test mode — not delivered</span>}</span>
        ) : 'None yet'}
      </Row>
      <Row label="Last reply">
        {loading ? '…' : error ? <Unavailable why="could not load" /> : inc ? <span>"{inc.message_text}" · {when(inc.received_date || inc.created_date)}</span> : 'None yet'}
      </Row>
      <Row label="No-shows">{noShows}{client.last_no_show_date ? ` (last ${client.last_no_show_date})` : ''}</Row>
      <Row label="Next reminder due">
        {client.next_reminder_date ? client.next_reminder_date : <Unavailable why="no reminder date is recorded for this client" />}
      </Row>
      <Row label="Reminders">{client.is_paused ? 'Paused' : 'Active'}</Row>
      <Link to={`/admin/messages?client=${client.id}`} className="inline-block mt-2 text-xs font-semibold text-indigo-600">Open full conversation</Link>
    </div>
  );
}