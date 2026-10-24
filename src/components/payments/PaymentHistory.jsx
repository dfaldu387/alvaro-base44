import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import { STATE_LABELS, money } from '@/lib/paymentApi';
import { historyRows } from '@/lib/paymentHistory';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);
const stamp = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? format(new Date(iso), 'd MMM yyyy, h:mm a') : '');

function Row({ r }) {
  return (
    <li className="py-2 text-xs space-y-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-zinc-900">{r.label}</span>
        {r.amount != null && <span className="text-zinc-700">{money(r.amount)}</span>}
        {r.simulated && <StatusBadge tone="test">SIMULATED</StatusBadge>}
      </div>
      <p className="text-zinc-500">{stamp(r.when)} · {r.actor}{r.change ? ` · ${r.change}` : ''}</p>
      {r.note && <p className="text-zinc-600 break-words">{r.note}</p>}
      {r.providerEventId && <p className="text-zinc-400 font-mono break-all">Square event {r.providerEventId}</p>}
    </li>
  );
}

// A booking's payment log, read from its PaymentEvent rows when opened.
export default function PaymentHistory({ bookingId }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFailed(false);
    base44.entities.PaymentEvent.filter({ booking_request_id: bookingId }, { sort: '-created_date', limit: 50 })
      .then((res) => setRows(historyRows(asList(res), STATE_LABELS))).catch(() => setFailed(true));
  }, [open, bookingId]);
  return (
    <div className="border-t border-zinc-200 pt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-zinc-700">
        Payment history <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (failed ? <p className="text-xs text-red-600 mt-2">Couldn't load the history.</p>
        : !rows ? <p className="text-xs text-zinc-500 mt-2">Loading…</p>
        : rows.length === 0 ? <p className="text-xs text-zinc-500 mt-2">Nothing recorded yet.</p>
        : <ul className="divide-y divide-zinc-100 mt-1">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>)}
    </div>
  );
}