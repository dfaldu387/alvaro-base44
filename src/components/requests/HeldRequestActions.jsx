import React from 'react';
import { CalendarPlus, ShieldCheck, Ban } from 'lucide-react';

const BASE = 'min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50';
const PRIMARY = 'bg-indigo-600 text-white hover:bg-indigo-700';
const SECONDARY = 'border border-zinc-200 bg-white text-zinc-700 hover:border-indigo-300 hover:text-indigo-600';
const REJECT = 'border border-zinc-200 bg-white text-zinc-500 hover:border-red-300 hover:text-red-600';

/**
 * The three decisions a held request needs.
 *
 * A request Booking Protection is holding is not on the schedule and cannot be
 * placed at all, so approving it is the only way forward. Approving changes
 * nothing about the appointment time: no message is sent and the customer is not
 * confirmed. "Approve & Place" then opens the normal placement dialog, which
 * offers only times the scheduling engine accepts.
 */
export default function HeldRequestActions({ onApprovePlace, onApproveOnly, onReject, disabled = false }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={onApprovePlace} disabled={disabled} className={`${BASE} ${PRIMARY}`}>
        <CalendarPlus className="w-3.5 h-3.5" />Approve &amp; Place
      </button>
      <button type="button" onClick={onApproveOnly} disabled={disabled} className={`${BASE} ${SECONDARY}`}>
        <ShieldCheck className="w-3.5 h-3.5" />Approve Only
      </button>
      <button type="button" onClick={onReject} disabled={disabled} className={`${BASE} ${REJECT}`}>
        <Ban className="w-3.5 h-3.5" />Reject
      </button>
    </div>
  );
}