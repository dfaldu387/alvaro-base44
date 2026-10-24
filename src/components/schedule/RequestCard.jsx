import React from 'react';
import { format } from 'date-fns';
import { GripVertical, Scissors, Clock, MapPin, Users, AlertCircle, ShieldAlert, Pencil, Ban, MoreHorizontal, CalendarPlus } from 'lucide-react';
import { stateLabel, stateTone, stateReason, isHeld, heldReason } from '@/lib/requestStatus';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import HeldRequestActions from '@/components/requests/HeldRequestActions';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

/** "Jordan M." → "JM", "Sam" → "SA". */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// One tint per customer, chosen from the name so a card looks the same every time.
const AVATAR_TONES = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
];
const avatarTone = (name) => {
  const sum = String(name || '').split('').reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return AVATAR_TONES[sum % AVATAR_TONES.length];
};

/**
 * One unresolved booking request in the day's requests column.
 *
 * The card itself is the drag handle — press it (or its grip) and move it onto the
 * calendar to place it. The buttons stop the drag, so editing or declining never
 * starts a placement.
 */
export default function RequestCard({
  request, onBeginPlacement, onEdit, onAddToCalendar, onDecline,
  onApproveOnly, onApprovePlace,
  dragging = false, busy = false, draggable = true,
}) {
  const services = Array.isArray(request.services) ? request.services : [];
  // A held request cannot be placed at all, so it gets the approval decisions
  // instead of a drag handle or an Add to Calendar action.
  const held = isHeld(request);
  const reason = stateReason(request);
  const window_ = request.availability_window || 'Flexible';
  const people = Number(request.people_count) || 1;
  const suburb = request.address_suburb
    || String(request.address || '').split(',').slice(-2).join(',').trim()
    || '';

  const handlePointerDown = (e) => {
    if (held || !draggable || e.target.closest('button') || e.button !== 0) return;
    onBeginPlacement?.(request, e);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`group px-3.5 py-3 text-left select-none ${dragging ? 'opacity-40' : draggable && !held ? 'cursor-grab active:cursor-grabbing' : ''} ${busy ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <div className="flex items-start gap-2">
        {draggable && !held && (
          <span title="Press and drag onto the calendar" className="mt-0.5 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500">
            <GripVertical className="h-4 w-4" />
          </span>
        )}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarTone(request.client_name)}`}>
          {initials(request.client_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-zinc-800 truncate">{request.client_name}</p>
            <StatusBadge tone={stateTone(request)}>{stateLabel(request)}</StatusBadge>
          </div>
          <p className="text-xs text-indigo-600 font-semibold mt-0.5">{window_}</p>
          <div className="flex items-center gap-2.5 mt-1 text-[11px] text-zinc-500 flex-wrap">
            {services.length > 0 && (
              <span className="flex items-center gap-1 truncate max-w-[150px]">
                <Scissors className="w-3 h-3 shrink-0" />{services.join(' + ')}
              </span>
            )}
            {request.duration_mins && (
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="w-3 h-3" />{request.duration_mins} min
              </span>
            )}
            <span className="flex items-center gap-1 shrink-0">
              <Users className="w-3 h-3" />{people} {people === 1 ? 'person' : 'people'}
            </span>
          </div>
          {suburb && (
            <p className="flex items-center gap-1 mt-1 text-[11px] text-zinc-500 truncate">
              <MapPin className="w-3 h-3 shrink-0" />{request.address_suburb || suburb}
            </p>
          )}
          {held ? (
            <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
              <p className="flex items-start gap-1 text-[11px] font-semibold text-amber-800 leading-snug">
                <ShieldAlert className="w-3 h-3 shrink-0 mt-[1px]" />Held for review
              </p>
              {heldReason(request) && (
                <p className="mt-0.5 pl-4 text-[11px] text-amber-700 leading-snug">{heldReason(request)}</p>
              )}
              <p className="mt-1 pl-4 text-[10px] text-amber-700/80 leading-snug">
                Not on the schedule until it is approved.
              </p>
            </div>
          ) : reason && (
            <p className="flex items-start gap-1 mt-1.5 text-[11px] text-amber-600 font-medium leading-snug">
              <AlertCircle className="w-3 h-3 shrink-0 mt-[1px]" />{reason}
            </p>
          )}
        </div>
      </div>

      {/* A held request's only ways forward are the approval decisions — the
          decline button below is the same thing as Reject, so it is not repeated. */}
      {held && (
        <div className="mt-2.5 pl-6" onPointerDown={e => e.stopPropagation()}>
          <HeldRequestActions
            onApprovePlace={() => onApprovePlace?.(request)}
            onApproveOnly={() => onApproveOnly?.(request)}
            onReject={() => onDecline?.(request)}
            disabled={busy}
          />
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-2.5 pl-6">
        <div className="flex-1" />
        <button type="button" onClick={() => onEdit?.(request)} title="Edit"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        {!held && (
          <button type="button" onClick={() => onDecline?.(request)} title="Decline"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-600 transition-colors">
            <Ban className="w-3.5 h-3.5" />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="More"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {request.requested_date && (
              <DropdownMenuItem disabled className="text-[11px] text-zinc-400">
                Requested for {format(new Date(`${request.requested_date}T00:00:00`), 'EEE d MMM')}
              </DropdownMenuItem>
            )}
            {held ? (
              // Never offer placement before approval: the schedule refuses it.
              <DropdownMenuItem disabled className="text-[11px] text-zinc-400">
                Approve this request to place it
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onAddToCalendar?.(request)}>
                <CalendarPlus className="w-3.5 h-3.5 mr-2" />Add to Calendar…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onEdit?.(request)}>
              <Pencil className="w-3.5 h-3.5 mr-2" />Edit details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}