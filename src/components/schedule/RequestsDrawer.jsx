import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { requestState, REQUEST_STATE } from '@/lib/requestStatus';
import { approveHeld } from '@/lib/reviewQueue';
import RequestCard from '@/components/schedule/RequestCard';
import EditRequestModal from '@/components/requests/EditRequestModal';
import AddToCalendarModal from '@/components/requests/AddToCalendarModal';
import DeclineRequestModal from '@/components/requests/DeclineRequestModal';

/**
 * The selected day's booking requests, in a panel beside the calendar.
 *
 * It is part of the Calendar, not a separate page: the week stays visible, the
 * chosen day stays highlighted, and a request is placed by dragging it out of this
 * list onto that day. A card is only ever listed while the day still has to decide
 * about it — once it has been placed it leaves the list, and cancelled, declined and
 * completed records were never here.
 *
 * All / Unscheduled / Needs Review / Processing: the four things an unresolved
 * request can be, so nothing is hidden behind a filter nobody opened.
 */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: REQUEST_STATE.unscheduled, label: 'Unscheduled' },
  { id: REQUEST_STATE.needs_review, label: 'Needs Review' },
  { id: REQUEST_STATE.processing, label: 'Processing' },
];

export default function RequestsDrawer({
  open, onClose, requests = [], dayLabel, onChanged, onBeginPlacement, draggingId = null, busyId = null,
  loading = false,
  // The filter to start on. A link that used to open the Needs Review page arrives
  // here instead, so the drawer opens on the state that link was about.
  initialFilter = 'all',
}) {
  const [filter, setFilter] = useState(initialFilter || 'all');

  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);

  const [editing, setEditing] = useState(null);
  const [placing, setPlacing] = useState(null);
  // True when the dialog was opened by "Approve & Place": the booking goes on the
  // calendar provisionally, so nothing is confirmed and no message is sent.
  const [placingProvisional, setPlacingProvisional] = useState(false);
  const [declining, setDeclining] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [notice, setNotice] = useState(null);

  const counts = useMemo(() => {
    const byState = { all: requests.length };
    for (const r of requests) {
      const s = requestState(r);
      byState[s] = (byState[s] || 0) + 1;
    }
    return byState;
  }, [requests]);

  const visible = useMemo(
    () => (filter === 'all' ? requests : requests.filter(r => requestState(r) === filter)),
    [requests, filter],
  );

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 5000);
  };
  const afterChange = (message) => {
    if (message) flash(message);
    onChanged?.();
  };

  // ── Held requests: approve, then place (or leave for later) ───────────────
  // Approval only releases the hold — it never confirms a time and never
  // messages the customer. Placement is a separate, validated step.
  const releaseHold = async (request) => {
    setApprovingId(request.id);
    const res = await approveHeld(request.id, { place: false });
    setApprovingId(null);
    if (res?.ok !== true) throw new Error(res?.error || 'That request could not be approved.');
    return res;
  };

  const handleApproveOnly = async (request) => {
    try {
      await releaseHold(request);
      afterChange(`${request.client_name} approved — release it onto the calendar whenever you are ready.`);
    } catch (e) {
      flash(e.message);
    }
  };

  const handleApproveAndPlace = async (request) => {
    try {
      await releaseHold(request);
      // The approval rewrites the record, so the dialog is opened on the approved
      // request itself — otherwise the placement would be refused as out of date.
      let approved = request;
      try { approved = await base44.entities.BookingRequest.get(request.id); } catch { /* keep the row we have */ }
      setPlacingProvisional(true);
      setPlacing(approved);
    } catch (e) {
      flash(e.message);
    }
  };

  const panel = (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <Inbox className="w-4 h-4 text-indigo-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-sm font-bold text-zinc-900">Booking Requests</span>
            <span className="rounded-full bg-[#6366f1] px-2 py-0.5 text-[11px] font-bold text-white min-w-[20px] text-center">
              {requests.length}
            </span>
          </div>
          {dayLabel && <p className="mt-0.5 text-[11px] text-zinc-500">— {dayLabel}</p>}
        </div>
        <button type="button" onClick={onClose} title="Hide requests"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-zinc-200 px-2.5 py-2">
        {FILTERS.map(f => {
          const count = counts[f.id] || 0;
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                active ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
              }`}
            >
              {f.label}
              <span className={`tabular-nums ${active ? 'text-indigo-500' : 'text-zinc-400'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {notice && (
        <div className="mx-3 mt-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700">
          {notice}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && requests.length === 0 ? (
          /* The panel's own skeleton: only this column waits, never the calendar. */
          <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading requests">
            {[0, 1, 2].map(i => (
              <div key={i} className="animate-pulse rounded-xl border border-zinc-100 bg-white p-3">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-24 rounded bg-zinc-100" />
                  <div className="ml-auto h-2.5 w-12 rounded bg-zinc-100" />
                </div>
                <div className="mt-2 h-2 w-32 rounded bg-zinc-100" />
                <div className="mt-1.5 h-2 w-20 rounded bg-zinc-100" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-xs font-semibold text-zinc-500">
              {requests.length === 0 ? 'Nothing waiting for this day' : 'Nothing in this filter'}
            </p>
            <p className="mt-1 text-[11px] text-zinc-400 leading-relaxed">
              {requests.length === 0
                ? 'Every request for this day is on the calendar.'
                : 'Choose another filter to see the rest.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {visible.map(req => (
              <RequestCard
                key={req.id}
                request={req}
                dragging={draggingId === req.id}
                busy={busyId === req.id || approvingId === req.id}
                draggable={!!onBeginPlacement}
                onBeginPlacement={onBeginPlacement}
                onEdit={setEditing}
                onAddToCalendar={(request) => { setPlacingProvisional(false); setPlacing(request); }}
                onDecline={setDeclining}
                onApproveOnly={handleApproveOnly}
                onApprovePlace={handleApproveAndPlace}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 px-3 py-2">
        <p className="text-[10px] leading-snug text-zinc-400">
          {onBeginPlacement
            ? `Press a request and drag it onto ${dayLabel || 'the day'} to place it. Every drop is checked by the scheduling engine before anything is saved.`
            : 'Use the ⋯ menu on a request to add it to the calendar.'}
        </p>
      </div>
    </>
  );

  // The panel is a column of the Calendar workspace: full height beside the week, never
  // an overlay on desktop and never a collapsed strip. Shut, it is simply gone and the
  // calendar has the room back.
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-900/30 lg:hidden" onClick={onClose} />

      <aside className="animate-in slide-in-from-right duration-200 fixed inset-y-0 right-0 z-50 flex w-[300px] max-w-[86%] shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-white shadow-2xl lg:static lg:z-auto lg:max-w-none lg:w-[300px] lg:shadow-none xl:w-[340px]">
        {panel}
      </aside>

      {editing && (
        <EditRequestModal
          request={editing}
          onClose={() => setEditing(null)}
          onDone={(data) => {
            const placed = data?.route_flow?.placed === true;
            afterChange(placed
              ? `Saved — Route Flow placed it provisionally at ${data.route_flow.assigned_time}.`
              : 'Saved — Route Flow re-checked it straight away; it is still unplaced and stays in this list.');
          }}
        />
      )}

      {placing && (
        <AddToCalendarModal
          request={placing}
          provisional={placingProvisional}
          onClose={() => {
            // Leaving the dialog after an approval: the request is released but
            // still unplaced, and it stays in this list ready for a time.
            if (placingProvisional) flash('Approved — not placed yet.');
            setPlacing(null);
            setPlacingProvisional(false);
          }}
          onDone={() => {
            const provisional = placingProvisional;
            setPlacingProvisional(false);
            afterChange(provisional
              ? 'Placed provisionally — no confirmation was sent.'
              : 'Placed on the calendar.');
          }}
        />
      )}

      {declining && (
        <DeclineRequestModal
          request={declining}
          onClose={() => setDeclining(null)}
          onDone={(reason) => afterChange(`Declined — ${reason}. It stays in your history.`)}
        />
      )}
    </>
  );
}